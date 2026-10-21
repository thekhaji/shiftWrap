import { Bot } from 'grammy';
import { Types } from 'mongoose';
import { MyContext } from '../server';
import MemberService from '../models/Member.service';
import BranchService from '../models/Branch.service';
import InviteService from '../models/Invite.service';
import { MemberStatus, MemberType } from '../libs/enums/member.enum';
import { Member } from '../libs/types/member';
import { isAdmin, isBossOrAdmin, isManagerOf } from '../libs/utils/permission';
import { allLabels, DEFAULT_LANG, t } from '../libs/i18n';
import { branchChoiceView, joinRequestView, mainMenuView, pendingView } from '../views/index';

const memberService = new MemberService();
const branchService = new BranchService();
const inviteService = new InviteService();

// "Which branch were you invited to?"
export async function askBranch(ctx: MyContext) {
    const branches = await branchService.getAllBranches();
    if (branches.length === 0) {
        await ctx.reply(t(ctx.lang, 'reg.noBranches'));
        return;
    }
    const view = branchChoiceView(ctx.lang, branches);
    await ctx.reply(view.text, { reply_markup: view.keyboard });
}

// what an unconfirmed employee sees instead of the bot's features
export async function sendPendingState(ctx: MyContext, member: Member) {
    const branch = member.branchId ? await branchService.getBranchById(member.branchId) : null;
    if (!branch) {
        if (member.branchId) await memberService.clearBranch(member.telegramId); // branch was deleted
        await askBranch(ctx);
        return;
    }
    const view = pendingView(ctx.lang, branch.name);
    await ctx.reply(view.text, { reply_markup: view.keyboard });
}

export function registrationController(bot: Bot<MyContext>) {
    // Gate: an employee still waiting for confirmation can only /start and answer the registration buttons.
    bot.use(async (ctx, next) => {
        if (ctx.chat?.type !== 'private' || !ctx.from) return next();
        const member = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!member || member.type !== MemberType.USER || member.status !== MemberStatus.PENDING) return next();

        const text = ctx.message?.text ?? '';
        const data = ctx.callbackQuery?.data ?? '';
        if (text.startsWith('/start') || data.startsWith('reg_')) return next();

        if (ctx.callbackQuery) await ctx.answerCallbackQuery();
        else if (ctx.message) await sendPendingState(ctx, member);
    });

    // the employee picked a branch: ask its manager(s) to confirm
    bot.callbackQuery(/^reg_branch:/, async (ctx) => {
        const member = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!member || member.type !== MemberType.USER || member.status !== MemberStatus.PENDING) {
            await ctx.answerCallbackQuery();
            return;
        }
        await ctx.answerCallbackQuery();
        if (member.branchId) {
            await sendPendingState(ctx, member); // already asked, don't notify twice
            return;
        }
        const branchId = ctx.callbackQuery.data.split(':')[1];
        const branch = Types.ObjectId.isValid(branchId) ? await branchService.getBranchById(new Types.ObjectId(branchId)) : null;
        if (!branch) return;

        const updated = await memberService.updateMember(member.telegramId, { branchId: branch._id });
        await ctx.editMessageText(t(ctx.lang, 'reg.requestSent', { branch: branch.name }), {
            reply_markup: pendingView(ctx.lang, branch.name).keyboard,
        });

        // the branch's managers; a branch without any is handled by bosses/admins
        const managers = await memberService.getManagersByBranch(branch._id);
        const approvers = managers.length ? managers : await memberService.getBossesAndAdmins();
        for (const approver of approvers) {
            const lang = approver.language ?? DEFAULT_LANG;
            const view = joinRequestView(lang, updated, branch.name, branch._id.toString());
            await ctx.api.sendMessage(approver.telegramId, view.text, { reply_markup: view.keyboard })
                .catch((err) => console.error(`join request to ${approver.telegramId} failed:`, err));
        }
    });

    // wrong branch picked: start over
    bot.callbackQuery("reg_change", async (ctx) => {
        const member = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!member || member.type !== MemberType.USER || member.status !== MemberStatus.PENDING) {
            await ctx.answerCallbackQuery();
            return;
        }
        await ctx.answerCallbackQuery();
        await memberService.clearBranch(member.telegramId);
        const branches = await branchService.getAllBranches();
        const view = branchChoiceView(ctx.lang, branches);
        await ctx.editMessageText(view.text, { reply_markup: view.keyboard });
    });

    // manager / boss / admin answers the request
    bot.callbackQuery(/^reg_(ok|no):/, async (ctx) => {
        const approve = ctx.callbackQuery.data.startsWith('reg_ok:');
        const [, telegramId, branchId] = ctx.callbackQuery.data.split(':');
        const actor = await memberService.getMemberByTelegramId(ctx.from.id);
        // callback data is client-controlled: only this branch's manager, a boss or an admin may answer
        if (!actor || !(isBossOrAdmin(actor) || isManagerOf(actor, branchId))) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.noPermissionShort') });
            return;
        }
        const target = Types.ObjectId.isValid(branchId)
            ? await memberService.resolveJoinRequest(Number(telegramId), new Types.ObjectId(branchId), approve)
            : null;
        if (!target) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'reg.alreadyHandled'), show_alert: true });
            await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
            return;
        }
        await ctx.answerCallbackQuery();
        await ctx.editMessageText(t(ctx.lang, approve ? 'reg.confirmedDone' : 'reg.rejectedDone', { name: target.name }));

        const lang = target.language ?? DEFAULT_LANG;
        const branch = await branchService.getBranchById(new Types.ObjectId(branchId));
        const branchName = branch?.name ?? '';
        if (approve) {
            const menu = mainMenuView(target);
            await ctx.api.sendMessage(target.telegramId, `${t(lang, 'reg.confirmed', { branch: branchName })}\n${menu.text}`, { reply_markup: menu.keyboard })
                .catch((err) => console.error(`confirm notice to ${target.telegramId} failed:`, err));
        } else {
            const view = branchChoiceView(lang, await branchService.getAllBranches());
            await ctx.api.sendMessage(target.telegramId, `${t(lang, 'reg.rejected', { branch: branchName })}\n\n${view.text}`, { reply_markup: view.keyboard })
                .catch((err) => console.error(`reject notice to ${target.telegramId} failed:`, err));
        }
    });

    // admin: one-time boss invitation link
    bot.hears(allLabels('menu.inviteBoss'), async (ctx) => {
        if (!ctx.from) return;
        const actor = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!actor || !isAdmin(actor)) {
            await ctx.reply(t(ctx.lang, 'common.noPermission'));
            return;
        }
        const token = await inviteService.createBossInvite(actor._id);
        await ctx.reply(t(ctx.lang, 'invite.created', { link: `https://t.me/${ctx.me.username}?start=boss_${token}` }));
    });
}
