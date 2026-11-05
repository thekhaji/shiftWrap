import { Api } from 'grammy';
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

    // groups the bot is currently in (membership can change any time, so ask Telegram);
    // adminOnly: just the ones where it is an admin
    async getAdminGroups(api: Api, botId: number, adminOnly = true): Promise<BotGroup[]> {
        const result: BotGroup[] = [];
        for (const g of await this.getAll()) {
            try {
                const me = await api.getChatMember(g.chatId, botId);
                if (me.status === 'administrator' || me.status === 'creator' || (!adminOnly && me.status === 'member')) result.push(g);
                else if (me.status === 'left' || me.status === 'kicked') await this.forget(g.chatId);
            } catch {
                await this.forget(g.chatId); // chat is gone or unreachable
            }
        }
        return result;
    }

    async getTitles(chatIds: number[]): Promise<Map<number, string>> {
        const groups = await BotGroupModel.find({ chatId: { $in: chatIds } }).lean<BotGroup[]>();
        return new Map(groups.map(g => [g.chatId, g.title]));
    }
}

export default GroupService;
