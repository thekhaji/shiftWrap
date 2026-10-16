import { Bot } from 'grammy';
import { MyContext } from '../../server';
import MemberModel from '../../schema/Member.model';
import { Member } from '../types/member';
import { MemberType } from '../enums/member.enum';
import { mainMenuView } from '../../views/index';

const ROLE_LABELS: Record<MemberType, string> = {
    USER: 'Xodim',
    MANAGER: 'Boshqaruvchi',
    BOSS: 'Boss',
    ADMIN: 'Admin',
};

// A Telegram reply keyboard lives in the user's client until the bot sends a new one.
// So whenever a member's role or branch changes (from the bot OR straight in the database),
// push them the menu that matches their new role.
export function startMenuSync(bot: Bot<MyContext>) {
    const stream = MemberModel.watch(
        [{
            $match: {
                operationType: 'update',
                $or: [
                    { 'updateDescription.updatedFields.type': { $exists: true } },
                    { 'updateDescription.updatedFields.branchId': { $exists: true } },
                ],
            },
        }],
        { fullDocument: 'updateLookup' }
    );

    stream.on('change', async (change: any) => {
        const member = change.fullDocument as Member | undefined;
        if (!member) return;
        const view = mainMenuView(member);
        await bot.api.sendMessage(
            member.telegramId,
            `Sizning rolingiz yangilandi: ${ROLE_LABELS[member.type]}.\n${view.text}`,
            { reply_markup: view.keyboard }
        ).catch((err) => console.error(`menu sync failed for ${member.telegramId}:`, err));
    });

    stream.on('error', (err) => console.error('menu sync stream error:', err));
}
