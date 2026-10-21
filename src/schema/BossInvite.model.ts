import mongoose, { Schema, Types } from 'mongoose';

// One-time link an admin sends to a future boss: t.me/<bot>?start=boss_<token>
const bossInviteSchema = new Schema(
    {
        token: { type: String, required: true, unique: true },
        createdBy: { type: Schema.Types.ObjectId, ref: 'Member', required: true },
        expiresAt: { type: Date, required: true },
        usedAt: { type: Date },
        usedBy: { type: Number },   // telegramId
    },
    { timestamps: true }
);

export interface BossInvite {
    token: string;
    createdBy: Types.ObjectId;
    expiresAt: Date;
    usedAt?: Date;
    usedBy?: number;
}

export default mongoose.model<BossInvite>('BossInvite', bossInviteSchema);
