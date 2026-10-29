import { Bot, InputFile } from 'grammy';
import { Types } from 'mongoose';
import { MyContext } from '../server';
import AttendanceService from '../models/Attendance.service';
import MemberService from '../models/Member.service';
import ReportService from '../models/Report.service';
import BranchService from '../models/Branch.service';
import { isBossOrAdmin, hasManagerPermission, hasSalaryAccess, isSalaryManagerOf } from '../libs/utils/permission';
import { branchPickerView, monthPickerView, payrollScopePickerView } from '../views/index';
import { formatMoney, renderPayrollChart } from '../libs/utils/payrollChart';
import { nowInSeoul } from '../libs/utils/time';
import { monthNames } from '../libs/i18n';
import { Attendance } from '../libs/types/attendance';
import { getMonthsBetween } from '../libs/utils/date';
import { allLabels, t } from '../libs/i18n';

const attendanceService = new AttendanceService();
const memberService = new MemberService();
const reportService = new ReportService();
const branchService = new BranchService();

async function sendBranchReport(ctx: MyContext, branchId: Types.ObjectId, year: number, month: number) {
    const branch = await branchService.getBranchById(branchId);
    if (!branch) {
        await ctx.reply(t(ctx.lang, 'common.branchNotFound'));
        return;
    }

    const memberIds = await attendanceService.getMemberIdsForBranchAndMonth(branchId, year, month);
    if (memberIds.length === 0) {
        await ctx.reply(t(ctx.lang, 'report.noData'));
        return;
    }

    const members = await memberService.getMembersByIds(memberIds);
    const shiftsByMember = new Map<string, Attendance[]>();
    await Promise.all(members.map(async (m) => {
        // scoped to this branch — a member's shifts at other branches don't belong in this report
        const shifts = await attendanceService.getShiftsForMemberBranchAndMonth(m._id, branchId, year, month);
        shiftsByMember.set(m._id.toString(), shifts);
    }));

    const buffer = await reportService.generateBranchReportFile(members, shiftsByMember, year, month);
    await ctx.replyWithDocument(new InputFile(buffer, `${branch.name}_${year}-${month}.xlsx`));
}

// branchId undefined = all branches
async function sendPayroll(ctx: MyContext, branchId?: Types.ObjectId) {
    let scopeName = t(ctx.lang, 'payroll.allBranches').replace(/^\S+\s/, '');
    if (branchId) {
        const branch = await branchService.getBranchById(branchId);
        if (!branch) {
            await ctx.reply(t(ctx.lang, 'common.branchNotFound'));
            return;
        }
        scopeName = branch.name;
    }

    const now = nowInSeoul(); // shifts are stored on the Seoul clock
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    const amounts = await attendanceService.getMonthlyPayroll(year, branchId);
    const names = monthNames(ctx.lang);

    const image = renderPayrollChart({
        scopeName,
        monthLabels: names.map(n => n.slice(0, 3)),
        amounts,
        currentMonth: month,
        labels: { thisMonth: t(ctx.lang, 'payroll.thisMonth'), title: t(ctx.lang, 'payroll.yearTitle', { year }) },
    });
    await ctx.replyWithPhoto(new InputFile(image, `payroll_${year}.png`), {
        caption: t(ctx.lang, 'payroll.caption', { scope: scopeName, month: names[month - 1], year, amount: formatMoney(amounts[month - 1]) }),
    });
}

export function reportController(bot: Bot<MyContext>) {
    bot.hears(allLabels('menu.payroll'), async (ctx) => {
        if (!ctx.from) return;
        const member = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!member) return;

        if (!hasSalaryAccess(member)) {
            await ctx.reply(t(ctx.lang, 'common.noPermission'));
        } else if (hasManagerPermission(member)) {
            await sendPayroll(ctx, member.branchId!);
        } else if (isBossOrAdmin(member)) {
            const view = payrollScopePickerView(ctx.lang, await branchService.getAllBranches());
            await ctx.reply(view.text, { reply_markup: view.keyboard });
        } else {
            await ctx.reply(t(ctx.lang, 'common.noPermission'));
        }
    });

    bot.callbackQuery(/^payroll:/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const member = await memberService.getMemberByTelegramId(ctx.from.id);
        const scope = ctx.callbackQuery.data.split(":")[1];
        // callback data is client-controlled, so re-check permission for the requested scope
        if (!member || !isBossOrAdmin(member)) {
            await ctx.reply(t(ctx.lang, 'common.noPermission'));
            return;
        }
        if (scope === 'ALL') {
            await sendPayroll(ctx);
        } else if (Types.ObjectId.isValid(scope)) {
            await sendPayroll(ctx, new Types.ObjectId(scope));
        }
    });

    bot.hears(allLabels('menu.report'), async (ctx) => {
        if (!ctx.from) return;

        const member = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!member) {
            await ctx.reply(t(ctx.lang, 'common.notRegistered'));
            return;
        }

        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;

        const branchIds = await attendanceService.getBranchIdsForMemberAndMonth(member._id, year, month);

        if (branchIds.length === 0) {
            await ctx.reply(t(ctx.lang, 'report.none'));
            return;
        }

        if (branchIds.length === 1) {
            // only one branch worked — skip the picker, generate directly
            const shifts = await attendanceService.getShiftsForMemberBranchAndMonth(member._id, branchIds[0], year, month);
            const buffer = await reportService.generateReportFile(member, shifts, year, month);
            await ctx.replyWithDocument(new InputFile(buffer, `${member.name}_${month}_${year}.xlsx`));
            return;
        }

        const branches = await branchService.getBranchesByIds(branchIds);
        const view = branchPickerView(ctx.lang, branches, year, month, "personal_report");
        await ctx.reply(view.text, { reply_markup: view.keyboard });
    });

    bot.hears(allLabels('menu.branchReport'), async (ctx) => {
        if (!ctx.from) return;

        const member = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!member) return;

        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;

        if (!hasSalaryAccess(member)) {
            await ctx.reply(t(ctx.lang, 'common.noPermission'));
        } else if (hasManagerPermission(member)) {
            await sendBranchReport(ctx, member.branchId!, year, month);
        } else if (isBossOrAdmin(member)) {
            const view = branchPickerView(ctx.lang, await branchService.getAllBranches(), year, month, "branch_report");
            await ctx.reply(view.text, { reply_markup: view.keyboard });
        } else {
            await ctx.reply(t(ctx.lang, 'common.noPermission'));
        }
    });

    bot.callbackQuery(/^branch_report:/, async (ctx) => {
        await ctx.answerCallbackQuery();
        if (!ctx.from) return;

        const member = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!member) return;

        const [branchIdStr, year, month] = ctx.callbackQuery.data.split(":")[1].split(",");
        if (!Types.ObjectId.isValid(branchIdStr)) return;

        // callback data is client-controlled, so re-check permission for the requested branch
        if (!isBossOrAdmin(member) && !isSalaryManagerOf(member, branchIdStr)) {
            await ctx.reply(t(ctx.lang, 'common.noPermission'));
            return;
        }

        await sendBranchReport(ctx, new Types.ObjectId(branchIdStr), Number(year), Number(month));
    });

    bot.hears(allLabels('menu.history'), async (ctx) => {
        if (!ctx.from) return;
        const member = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!member) return;

        const firstCheckIn = await attendanceService.getFirstCheckInDate(member._id);
        if (!firstCheckIn) {
            await ctx.reply(t(ctx.lang, 'report.noHistory'));
            return;
        }

        const now = new Date();
        const months = getMonthsBetween(
            firstCheckIn.getFullYear(), firstCheckIn.getMonth() + 1,
            now.getFullYear(), now.getMonth() + 1
        );

        if (months.length === 0) {
            await ctx.reply(t(ctx.lang, 'report.noPast'));
            return;
        }

        const view = monthPickerView(ctx.lang, months);
        await ctx.reply(view.text, { reply_markup: view.keyboard });
    });

    bot.callbackQuery(/^history_month:/, async (ctx) => {
        await ctx.answerCallbackQuery();
        if (!ctx.from) return;
        const member = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!member) return;

        const [year, month] = ctx.callbackQuery.data.split(":")[1].split("-").map(Number);

        // reuse the exact same branch-count logic from the current-month report
        const branchIds = await attendanceService.getBranchIdsForMemberAndMonth(member._id, year, month);

        if (branchIds.length === 0) {
            await ctx.reply(t(ctx.lang, 'report.noData'));
            return;
        }

        if (branchIds.length === 1) {
            const shifts = await attendanceService.getShiftsForMemberBranchAndMonth(member._id, branchIds[0], year, month);
            const buffer = await reportService.generateReportFile(member, shifts, year, month);
            await ctx.replyWithDocument(new InputFile(buffer, `${member.name}_${month}_${year}.xlsx`));
            return;
        }
        const branches = await branchService.getBranchesByIds(branchIds);
        const view = branchPickerView(ctx.lang, branches, year, month, "personal_report");
        await ctx.reply(view.text, { reply_markup: view.keyboard });
    });

    bot.callbackQuery(/^personal_report:/, async (ctx) => {
        await ctx.answerCallbackQuery();
        if (!ctx.from) return;
        const member = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!member) return;
        const [branchIdStr, year, month] = ctx.callbackQuery.data.split(":")[1].split(",");
        const branchId = new Types.ObjectId(branchIdStr);

        const shifts = await attendanceService.getShiftsForMemberBranchAndMonth(member._id, branchId, Number(year), Number(month));
        const buffer = await reportService.generateReportFile(member, shifts, Number(year), Number(month));
        await ctx.replyWithDocument(new InputFile(buffer, `${member.name}_${month}_${year}.xlsx`));
    });
}

