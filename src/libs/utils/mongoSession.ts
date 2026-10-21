import mongoose from 'mongoose';
import { StorageAdapter } from 'grammy';

const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

// Sessions live in MongoDB so a restart or deploy doesn't wipe half-finished flows
// (adding a product, a cleaning upload, a report being checked...).
export function mongoSessionStorage<T>(): StorageAdapter<T> {
    const sessions = mongoose.connection.collection('sessions');
    sessions.createIndex({ updatedAt: 1 }, { expireAfterSeconds: SESSION_TTL_SECONDS })
        .catch((err) => console.error("session index failed:", err));

    return {
        async read(key) {
            const doc = await sessions.findOne({ _id: key as any });
            return doc?.value as T | undefined;
        },
        async write(key, value) {
            // ignoreUndefined: an unset field stays absent instead of becoming null
            await sessions.updateOne(
                { _id: key as any },
                { $set: { value, updatedAt: new Date() } },
                { upsert: true, ignoreUndefined: true }
            );
        },
        async delete(key) {
            await sessions.deleteOne({ _id: key as any });
        },
    };
}
