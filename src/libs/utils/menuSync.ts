import { Bot } from 'grammy';
import { MyContext } from '../../server';
import MemberModel from '../../schema/Member.model';
import { Member } from '../types/member';
import { DEFAULT_LANG, t } from '../i18n';
import { mainMenuView } from '../../views/index';

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
        const lang = member.language ?? DEFAULT_LANG;
        const view = mainMenuView(member);
        await bot.api.sendMessage(
            member.telegramId,
            `${t(lang, 'role.changed', { role: t(lang, `role.${member.type}`) })}\n${view.text}`,
            { reply_markup: view.keyboard }
        ).catch((err) => console.error(`menu sync failed for ${member.telegramId}:`, err));
    });

    stream.on('error', (err) => console.error('menu sync stream error:', err));
}
