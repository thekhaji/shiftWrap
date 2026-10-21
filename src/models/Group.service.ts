import BotGroupModel, { BotGroup } from '../schema/BotGroup.model';

class GroupService {
    async remember(chatId: number, title: string): Promise<void> {
        await BotGroupModel.updateOne({ chatId }, { $set: { title } }, { upsert: true });
    }

    async forget(chatId: number): Promise<void> {
        await BotGroupModel.deleteOne({ chatId });
    }

    async getAll(): Promise<BotGroup[]> {
        return BotGroupModel.find().sort({ title: 1 }).lean<BotGroup[]>();
    }

    async getTitles(chatIds: number[]): Promise<Map<number, string>> {
        const groups = await BotGroupModel.find({ chatId: { $in: chatIds } }).lean<BotGroup[]>();
        return new Map(groups.map(g => [g.chatId, g.title]));
    }
}

export default GroupService;
