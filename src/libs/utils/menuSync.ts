import { Bot } from 'grammy';
import { MyContext } from '../../server';
import MemberModel from '../../schema/Member.model';
import { Member } from '../types/member';
import { DEFAULT_LANG, t } from '../i18n';
import { mainMenuView } from '../../views/index';
import { isAssistant } from './permission';
import BranchService from '../../models/Branch.service';

// A Telegram reply keyboard lives in the user's client until the bot sends a new one.
// So whenever a member's role or branch changes (from the bot OR straight in the database),
// push them the menu that matches their new role.
export function startMenuSync(bot: Bot<MyContext>) {
    const branchService = new BranchService();
    const stream = MemberModel.watch(
        [{
            $match: {
                operationType: 'update',
                $or: [
                    { 'updateDescription.updatedFields.type': { $exists: true } },
                    { 'updateDescription.updatedFields.managerRole': { $exists: true } },
                    { 'updateDescription.updatedFields.branchId': { $exists: true } },
                ],
            },
        }],
        { fullDocument: 'updateLookup' }
    );

    stream.on('change', async (change: any) => {
        const member = change.fullDocument as Member | undefined;
        if (!member || member.status === 'PENDING') return;
        const lang = member.language ?? DEFAULT_LANG;
        const view = mainMenuView(member);
        // only the branch changed (an admin moved the employee): say that, not "role updated"
        const fields = change.updateDescription?.updatedFields ?? {};
        const branchOnly = 'branchId' in fields && !('type' in fields) && !('managerRole' in fields);
        const branch = branchOnly && member.branchId ? await branchService.getBranchById(member.branchId) : null;
        const headline = branch
            ? t(lang, 'branch.changed', { branch: branch.name })
            : t(lang, 'role.changed', { role: t(lang, isAssistant(member) ? 'role.ASSISTANT' : `role.${member.type}`) });
        await bot.api.sendMessage(
            member.telegramId,
            `${headline}\n${view.text}`,
            { reply_markup: view.keyboard }
        ).catch((err) => console.error(`menu sync failed for ${member.telegramId}:`, err));
    });

    stream.on('error', (err) => console.error('menu sync stream error:', err));
}
