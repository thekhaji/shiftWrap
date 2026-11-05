import mongoose, { Schema, Types } from 'mongoose';

// One-time link an admin sends to a future boss (start=boss_<token>) or Express driver (start=driver_<token>)
const bossInviteSchema = new Schema(
    {
        token: { type: String, required: true, unique: true },
        createdBy: { type: Schema.Types.ObjectId, ref: 'Member', required: true },
        expiresAt: { type: Date, required: true },
        role: { type: String, enum: ['BOSS', 'DRIVER'], default: 'BOSS' },
        usedAt: { type: Date },
        usedBy: { type: Number },   // telegramId
    },
    { timestamps: true }
);

export interface BossInvite {
    token: string;
    createdBy: Types.ObjectId;
    expiresAt: Date;
    role?: 'BOSS' | 'DRIVER';
    usedAt?: Date;
    usedBy?: number;
}

export default mongoose.model<BossInvite>('BossInvite', bossInviteSchema);
