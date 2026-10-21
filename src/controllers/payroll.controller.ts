import { Bot } from 'grammy';
import { Types } from 'mongoose';
import { MyContext } from '../server';
import AttendanceService from '../models/Attendance.service';
import BranchService from '../models/Branch.service';
import MemberService from '../models/Member.service';
import PayrollService from '../models/Payroll.service';
import { Member } from '../libs/types/member';
import { hasManagerPermission, isBossOrAdmin, isManagerOf } from '../libs/utils/permission';
import { previousMonthSeoul } from '../libs/utils/date';
import { allLabels, t } from '../libs/i18n';
import { approvalRequestView, branchPickerView, joinRequestView, payrollStatusView } from '../views/index';

const attendanceService = new AttendanceService();
const branchService = new BranchService();
const memberService = new MemberService();
const payrollService = new PayrollService();

function hours(minutes: number): string {
    return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

// managers of a branch, bosses and admins
function canReview(member: Member | null): member is Member {
    return !!member && (hasManagerPermission(member) || isBossOrAdmin(member));
}

export function payrollController(bot: Bot<MyContext>) {

    // everything still waiting for this person's decision, in one place
    bot.hears(allLabels('menu.requests'), async (ctx) => {
        if (!ctx.from) return;
        const actor = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!canReview(actor)) {
            await ctx.reply(t(ctx.lang, 'common.noPermission'));
            return;
        }
        const scope = isBossOrAdmin(actor) ? undefined : actor.branchId;
        const branches = new Map((await branchService.getAllBranches()).map(b => [b._id.toString(), b.name]));

        const employees = await memberService.getPendingMembers(scope);
        // a manager can't approve their own edits
        const submissions = (await payrollService.getPending(scope)).filter(s => !s.memberId.equals(actor._id));

        if (employees.length === 0 && submissions.length === 0) {
            await ctx.reply(t(ctx.lang, 'req.none'));
            return;
        }

        for (const e of employees) {
            const branchId = e.branchId!.toString();
            const view = joinRequestView(ctx.lang, e, branches.get(branchId) ?? '', branchId);
            await ctx.reply(view.text, { reply_markup: view.keyboard });
        }

        const names = new Map((await memberService.getMembersByIds(submissions.map(s => s.memberId))).map(m => [m._id.toString(), m.name]));
        for (const s of submissions) {
            const view = approvalRequestView(ctx.lang, {
                name: names.get(s.memberId.toString()) ?? '—',
                branch: branches.get(s.branchId.toString()) ?? '',
                month: s.month, year: s.year,
                before: hours(s.minutesBefore), after: hours(s.minutesAfter),
                lines: s.changeLines, subId: s._id.toString(), revision: s.revision,
            });
            await ctx.reply(view.text, { reply_markup: view.keyboard });
        }
    });

    // who has submitted last month's report, and whether the branch is closed
    async function statusFor(lang: MyContext['lang'], branchId: Types.ObjectId) {
        const { year, month } = previousMonthSeoul();
        const branch = await branchService.getBranchById(branchId);
        if (!branch) return null;
        const required = await attendanceService.getMemberIdsForBranchAndMonth(branchId, year, month);
        const members = (await memberService.getMembersByIds(required)).sort((a, b) => a.name.localeCompare(b.name));
        const statuses = await payrollService.getStatuses(branchId, year, month);

        const icon = { APPROVED: '✅', PENDING: '⏳', REJECTED: '❌' } as const;
        const lines = members.map(m => `${icon[statuses.get(m._id.toString()) ?? 'REJECTED']} ${m.name}`);
        const done = members.filter(m => statuses.get(m._id.toString()) === 'APPROVED').length;
        return payrollStatusView(lang, {
            branchId: branchId.toString(), branch: branch.name, month, year,
            lines, done, total: members.length, closed: await payrollService.isClosed(branchId, year, month),
        });
    }

    bot.hears(allLabels('menu.payrollStatus'), async (ctx) => {
        if (!ctx.from) return;
        const actor = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!canReview(actor)) {
            await ctx.reply(t(ctx.lang, 'common.noPermission'));
            return;
        }
        if (!isBossOrAdmin(actor)) {
            const view = await statusFor(ctx.lang, actor.branchId!);
            if (view) await ctx.reply(view.text, { reply_markup: view.keyboard });
            return;
        }
        const { year, month } = previousMonthSeoul();
        const view = branchPickerView(ctx.lang, await branchService.getAllBranches(), year, month, 'ps_branch');
        await ctx.reply(view.text, { reply_markup: view.keyboard });
    });

    bot.callbackQuery(/^ps_branch:/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const actor = await memberService.getMemberByTelegramId(ctx.from.id);
        const branchId = ctx.callbackQuery.data.split(':')[1].split(',')[0];
        // callback data is client-controlled, so check the permission for the requested branch
        if (!actor || !Types.ObjectId.isValid(branchId) || !(isBossOrAdmin(actor) || isManagerOf(actor, branchId))) return;
        const view = await statusFor(ctx.lang, new Types.ObjectId(branchId));
        if (view) await ctx.reply(view.text, { reply_markup: view.keyboard });
    });

    // let the branch change reports again; it closes again once everyone is approved
    bot.callbackQuery(/^ps_reopen:/, async (ctx) => {
        const actor = await memberService.getMemberByTelegramId(ctx.from.id);
        const branchId = ctx.callbackQuery.data.split(':')[1];
        if (!actor || !Types.ObjectId.isValid(branchId) || !(isBossOrAdmin(actor) || isManagerOf(actor, branchId))) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.noPermissionShort') });
            return;
        }
        const { year, month } = previousMonthSeoul();
        await payrollService.reopen(new Types.ObjectId(branchId), year, month);
        await ctx.answerCallbackQuery({ text: t(ctx.lang, 'ps.reopened'), show_alert: true });
        const view = await statusFor(ctx.lang, new Types.ObjectId(branchId));
        if (view) await ctx.editMessageText(view.text, { reply_markup: view.keyboard }).catch(() => {});
    });
}
