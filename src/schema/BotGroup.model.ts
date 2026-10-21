import mongoose, { Schema } from 'mongoose';

// Telegram has no "list the chats of this bot" call, so groups are remembered as the bot sees them.
const botGroupSchema = new Schema(
    {
        chatId: { type: Number, required: true, unique: true },
        title: { type: String, required: true },
    },
    { timestamps: true }
);

export interface BotGroup {
    chatId: number;
    title: string;
}

export default mongoose.model<BotGroup>('BotGroup', botGroupSchema);
