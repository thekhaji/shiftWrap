import crypto from 'crypto';
import { Types } from 'mongoose';
import BossInviteModel from '../schema/BossInvite.model';

const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

class InviteService {
    async createBossInvite(createdBy: Types.ObjectId): Promise<string> {
        const token = crypto.randomBytes(16).toString('base64url');
        await BossInviteModel.create({ token, createdBy, expiresAt: new Date(Date.now() + INVITE_TTL_MS) });
        return token;
    }

    async isValid(token: string): Promise<boolean> {
        return !!(await BossInviteModel.exists({ token, usedAt: null, expiresAt: { $gt: new Date() } }));
    }

    // atomic, so one link can never register two people
    async consume(token: string, telegramId: number): Promise<boolean> {
        const invite = await BossInviteModel.findOneAndUpdate(
            { token, usedAt: null, expiresAt: { $gt: new Date() } },
            { $set: { usedAt: new Date(), usedBy: telegramId } }
        );
        return !!invite;
    }

    // give the link back when registration failed after consuming it
    async release(token: string): Promise<void> {
        await BossInviteModel.updateOne({ token }, { $unset: { usedAt: '', usedBy: '' } });
    }
}

export default InviteService;
