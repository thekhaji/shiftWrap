import { Bot } from 'grammy';
import { MyContext } from '../../server';
import MemberModel from '../../schema/Member.model';
import { Member } from '../types/member';
import { MemberStatus, MemberType } from '../enums/member.enum';
import { DEFAULT_LANG, t } from '../i18n';
import { mainMenuView, menuUpdatedView } from '../../views/index';
import BranchModel from '../../schema/Branch.model';
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
        const view = await mainMenuView(member);
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

    // the admin gave a branch Express access (or took it away): its managers get the menu with or without the Express button
    const branchStream = BranchModel.watch(
        [{ $match: { operationType: 'update' } }],
        { fullDocument: 'updateLookup' }
    );

    branchStream.on('change', async (change: any) => {
        const touched = [...Object.keys(change.updateDescription?.updatedFields ?? {}), ...(change.updateDescription?.removedFields ?? [])];
        if (!touched.some(k => k.startsWith('expressSupplierIds')) || !change.fullDocument) return;
        const managers = await MemberModel.find({ type: MemberType.MANAGER, branchId: change.fullDocument._id, status: MemberStatus.ACTIVE }).lean<Member[]>();
        for (const m of managers) {
            const view = await menuUpdatedView(m);
            await bot.api.sendMessage(m.telegramId, t(m.language ?? DEFAULT_LANG, 'express.accessChanged'), { reply_markup: view.keyboard })
                .catch((err) => console.error(`express menu sync failed for ${m.telegramId}:`, err));
        }
    });

    branchStream.on('error', (err) => console.error('branch menu sync stream error:', err));
}
