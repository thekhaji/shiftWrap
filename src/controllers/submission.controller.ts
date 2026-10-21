import { Bot, InlineKeyboard, InputFile } from 'grammy';
import { Types } from 'mongoose';
import { MyContext } from '../server';
import AttendanceService from '../models/Attendance.service';
import BranchService from '../models/Branch.service';
import MemberService from '../models/Member.service';
import PayrollService from '../models/Payroll.service';
import ReportService from '../models/Report.service';
import { Attendance } from '../libs/types/attendance';
import { Member } from '../libs/types/member';
import { MemberStatus, MemberType } from '../libs/enums/member.enum';
import { allLabels, DEFAULT_LANG, monthNames, t } from '../libs/i18n';
import { buildPlan, readEditedReport, ShiftPlan } from '../libs/utils/reportEdit';
import { formatMoney } from '../libs/utils/payrollChart';
import { nowInSeoul } from '../libs/utils/time';
import { branchPickerView } from '../views/index';

const attendanceService = new AttendanceService();
const branchService = new BranchService();
const memberService = new MemberService();
const payrollService = new PayrollService();
const reportService = new ReportService();

const MAX_FILE_BYTES = 5_000_000;
const MAX_LISTED_CHANGES = 10;

// reports are submitted for the month that has just ended
function previousMonth(): { year: number; month: number } {
    const now = nowInSeoul();
    const current = now.getUTCMonth(); // 0-based, so this is last month's 1-based number
    return current === 0 ? { year: now.getUTCFullYear() - 1, month: 12 } : { year: now.getUTCFullYear(), month: current };
}

function hours(minutes: number): string {
    return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

// boss and admin are not paid by the hour here, so they don't submit reports
function canSubmit(member: Member | null): member is Member {
    return !!member && member.status === MemberStatus.ACTIVE
        && (member.type === MemberType.USER || member.type === MemberType.MANAGER);
}

export function submissionController(bot: Bot<MyContext>) {

    async function startSubmission(ctx: MyContext, member: Member, branchId: Types.ObjectId, year: number, month: number) {
        const names = monthNames(ctx.lang);
        const branch = await branchService.getBranchById(branchId);
        if (!branch) return;
        if (await payrollService.isClosed(branchId, year, month)) {
            await ctx.reply(t(ctx.lang, 'sub.locked', { month: names[month - 1], year }));
            return;
        }
        const shifts = await attendanceService.getShiftsForMemberBranchAndMonth(member._id, branchId, year, month);
        if (shifts.length === 0) {
            await ctx.reply(t(ctx.lang, 'report.noData'));
            return;
        }

        const file = await reportService.generateSubmissionFile(member, shifts, branchId.toString(), year, month);
        ctx.session.submitReport = { branchId: branchId.toString(), year, month };

        let caption = t(ctx.lang, 'sub.caption', { month: names[month - 1], year, branch: branch.name });
        if (await payrollService.hasSubmitted(member._id, branchId, year, month)) {
            caption = `${t(ctx.lang, 'sub.alreadyNote')}\n\n${caption}`;
        }
        const keyboard = new InlineKeyboard()
            .text(t(ctx.lang, 'sub.btnAsIs'), 'sub_as_is')
            .text(t(ctx.lang, 'common.cancel'), 'sub_cancel');
        await ctx.replyWithDocument(new InputFile(file, `${member.name}_${month}_${year}.xlsx`), { caption, reply_markup: keyboard });
    }

    bot.hears(allLabels('menu.submitReport'), async (ctx) => {
        if (!ctx.from) return;
        const member = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!canSubmit(member)) {
            await ctx.reply(t(ctx.lang, 'common.noPermission'));
            return;
        }
        const { year, month } = previousMonth();
        const branchIds = await attendanceService.getBranchIdsForMemberAndMonth(member._id, year, month);
        if (branchIds.length === 0) {
            await ctx.reply(t(ctx.lang, 'report.noData'));
            return;
        }
        if (branchIds.length === 1) {
            await startSubmission(ctx, member, branchIds[0], year, month);
            return;
        }
        const view = branchPickerView(ctx.lang, await branchService.getBranchesByIds(branchIds), year, month, 'submit_branch');
        await ctx.reply(view.text, { reply_markup: view.keyboard });
    });

    bot.callbackQuery(/^submit_branch:/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const member = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!canSubmit(member)) return;
        // callback data is client-controlled: the month is recomputed and the branch must be one they worked at
        const { year, month } = previousMonth();
        const branchId = ctx.callbackQuery.data.split(':')[1].split(',')[0];
        const branchIds = await attendanceService.getBranchIdsForMemberAndMonth(member._id, year, month);
        const chosen = branchIds.find(id => id.toString() === branchId);
        if (chosen) await startSubmission(ctx, member, chosen, year, month);
    });

    // the employee sends the edited file back
    bot.on('message:document', async (ctx, next) => {
        const state = ctx.session.submitReport;
        if (!state) return next();
        const member = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!canSubmit(member)) return;

        const doc = ctx.message.document;
        if (!doc.file_name?.toLowerCase().endsWith('.xlsx') || (doc.file_size ?? 0) > MAX_FILE_BYTES) {
            await ctx.reply(t(ctx.lang, 'sub.sendXlsx'));
            return;
        }
        const branchId = new Types.ObjectId(state.branchId);
        if (await payrollService.isClosed(branchId, state.year, state.month)) {
            ctx.session.submitReport = undefined;
            await ctx.reply(t(ctx.lang, 'sub.locked', { month: monthNames(ctx.lang)[state.month - 1], year: state.year }));
            return;
        }

        let buffer: Buffer;
        try {
            const file = await ctx.api.getFile(doc.file_id);
            const res = await fetch(`https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`);
            if (!res.ok) throw new Error(`download failed: ${res.status}`);
            buffer = Buffer.from(await res.arrayBuffer());
        } catch (err) {
            console.error("report download failed:", err);
            await ctx.reply(t(ctx.lang, 'sub.unreadable'));
            return;
        }

        const parsed = await readEditedReport(buffer, `shiftwrap:${member._id}:${state.branchId}:${state.year}:${state.month}`);
        if ('error' in parsed) {
            await ctx.reply(t(ctx.lang, parsed.error === 'wrongFile' ? 'sub.wrongFile' : 'sub.unreadable'));
            return;
        }
        const shifts = await attendanceService.getShiftsForMemberBranchAndMonth(member._id, branchId, state.year, state.month);
        const result = buildPlan(parsed.rows, shifts, state.year, state.month, member.hourlyRate);
        if ('errors' in result) {
            const list = result.errors.slice(0, MAX_LISTED_CHANGES).map(e => t(ctx.lang, e.key, { row: e.row })).join('\n');
            await ctx.reply(t(ctx.lang, 'sub.errors', { list }));
            return;
        }

        const plan = result.plan;
        state.plan = plan;
        const keyboard = new InlineKeyboard()
            .text(t(ctx.lang, 'sub.btnSubmit'), 'sub_confirm')
            .text(t(ctx.lang, 'common.cancel'), 'sub_cancel');
        if (plan.changeCount === 0) {
            await ctx.reply(t(ctx.lang, 'sub.noChangesFound'), { reply_markup: keyboard });
            return;
        }
        await ctx.reply(t(ctx.lang, 'sub.summary', {
            n: plan.changeCount,
            list: changeList(plan),
            before: hours(plan.minutesBefore),
            after: hours(plan.minutesAfter),
        }), { reply_markup: keyboard });
    });

    bot.callbackQuery('sub_cancel', async (ctx) => {
        ctx.session.submitReport = undefined;
        await ctx.answerCallbackQuery();
        await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
        await ctx.reply(t(ctx.lang, 'common.cancelled'));
    });

    // submit the report exactly as it is in the database
    bot.callbackQuery('sub_as_is', async (ctx) => {
        const member = await memberService.getMemberByTelegramId(ctx.from.id);
        const state = ctx.session.submitReport;
        if (!canSubmit(member) || !state) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'sub.expired'), show_alert: true });
            return;
        }
        const shifts = await attendanceService.getShiftsForMemberBranchAndMonth(member._id, new Types.ObjectId(state.branchId), state.year, state.month);
        const result = buildPlan([], shifts, state.year, state.month, member.hourlyRate);
        if ('errors' in result) return;
        await ctx.answerCallbackQuery();
        await finalize(ctx, member, result.plan);
    });

    // submit the edited file that was checked a moment ago
    bot.callbackQuery('sub_confirm', async (ctx) => {
        const member = await memberService.getMemberByTelegramId(ctx.from.id);
        const plan = ctx.session.submitReport?.plan;
        if (!canSubmit(member) || !plan) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'sub.expired'), show_alert: true });
            return;
        }
        await ctx.answerCallbackQuery();
        await finalize(ctx, member, plan);
    });

    function changeList(plan: ShiftPlan): string {
        const lines = plan.changeLines.slice(0, MAX_LISTED_CHANGES);
        if (plan.changeLines.length > lines.length) lines.push(`… +${plan.changeLines.length - lines.length}`);
        return lines.join('\n');
    }

    async function finalize(ctx: MyContext, member: Member, plan: ShiftPlan) {
        const state = ctx.session.submitReport!;
        ctx.session.submitReport = undefined; // a second tap on the button finds nothing to submit
        const { year, month } = state;
        const branchId = new Types.ObjectId(state.branchId);
        const names = monthNames(ctx.lang);

        if (await payrollService.isClosed(branchId, year, month)) {
            await ctx.reply(t(ctx.lang, 'sub.locked', { month: names[month - 1], year }));
            return;
        }

        await attendanceService.applyShiftPlan(member._id, branchId, plan, member.hourlyRate);
        await payrollService.saveSubmission({
            memberId: member._id, branchId, year, month,
            minutesBefore: plan.minutesBefore, minutesAfter: plan.minutesAfter, changeLines: plan.changeLines,
        });
        await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
        await ctx.reply(t(ctx.lang, 'sub.submitted'));

        const branch = await branchService.getBranchById(branchId);
        await notifyApprovers(ctx, member, branch?.name ?? '', branchId, year, month, plan);

        const required = await attendanceService.getMemberIdsForBranchAndMonth(branchId, year, month);
        if (await payrollService.markReadyIfComplete(branchId, year, month, required)) {
            await notifyBossesReady(ctx, branch?.name ?? '', branchId, required, year, month);
        }
    }

    // the branch's other managers see who submitted and what changed; with none, bosses and admins do
    async function notifyApprovers(ctx: MyContext, member: Member, branchName: string, branchId: Types.ObjectId, year: number, month: number, plan: ShiftPlan) {
        const managers = (await memberService.getManagersByBranch(branchId)).filter(m => m.telegramId !== member.telegramId);
        const recipients = managers.length ? managers : await memberService.getBossesAndAdmins();
        const shifts = await attendanceService.getShiftsForMemberBranchAndMonth(member._id, branchId, year, month);
        const file = await reportService.generateReportFile(member, shifts, year, month);

        for (const r of recipients) {
            const lang = r.language ?? DEFAULT_LANG;
            let caption = t(lang, 'sub.notice', {
                name: member.name, branch: branchName, month: monthNames(lang)[month - 1], year, hours: hours(plan.minutesAfter),
            });
            caption += plan.changeCount === 0
                ? `\n${t(lang, 'sub.noChanges')}`
                : `\n${t(lang, 'sub.changesHeader', { n: plan.changeCount, before: hours(plan.minutesBefore) })}\n${changeList(plan)}`;
            await ctx.api.sendDocument(r.telegramId, new InputFile(file, `${member.name}_${month}_${year}.xlsx`), { caption: caption.slice(0, 1000) })
                .catch((err) => console.error(`submission notice to ${r.telegramId} failed:`, err));
        }
    }

    // every employee of the branch has submitted: bosses and admins get the payroll report
    async function notifyBossesReady(ctx: MyContext, branchName: string, branchId: Types.ObjectId, memberIds: Types.ObjectId[], year: number, month: number) {
        const members = await memberService.getMembersByIds(memberIds);
        const shiftsByMember = new Map<string, Attendance[]>();
        await Promise.all(members.map(async (m) => {
            shiftsByMember.set(m._id.toString(), await attendanceService.getShiftsForMemberBranchAndMonth(m._id, branchId, year, month));
        }));
        const file = await reportService.generateBranchReportFile(members, shiftsByMember, year, month);
        const total = (await attendanceService.getMonthlyPayroll(year, branchId))[month - 1];

        for (const boss of await memberService.getBossesAndAdmins()) {
            const lang = boss.language ?? DEFAULT_LANG;
            const caption = t(lang, 'sub.ready', {
                branch: branchName, count: members.length, month: monthNames(lang)[month - 1], year, amount: formatMoney(total),
            });
            await ctx.api.sendDocument(boss.telegramId, new InputFile(file, `${branchName}_${year}-${month}.xlsx`), { caption })
                .catch((err) => console.error(`payroll ready notice to ${boss.telegramId} failed:`, err));
        }
    }
}
