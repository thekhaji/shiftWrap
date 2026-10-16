import { Bot, InputFile } from 'grammy';
import { Types } from 'mongoose';
import { MyContext } from '../server';
import AttendanceService from '../models/Attendance.service';
import MemberService from '../models/Member.service';
import ReportService from '../models/Report.service';
import BranchService from '../models/Branch.service';
import { isBossOrAdmin, hasManagerPermission, isManagerOf } from '../libs/utils/permission';
import { branchPickerView, monthPickerView } from '../views/index';
import { Attendance } from '../libs/types/attendance';
import { getMonthsBetween } from '../libs/utils/date';

const attendanceService = new AttendanceService();
const memberService = new MemberService();
const reportService = new ReportService();
const branchService = new BranchService();

async function sendBranchReport(ctx: MyContext, branchId: Types.ObjectId, year: number, month: number) {
    const branch = await branchService.getBranchById(branchId);
    if (!branch) {
        await ctx.reply("Filial topilmadi.");
        return;
    }

    const memberIds = await attendanceService.getMemberIdsForBranchAndMonth(branchId, year, month);
    if (memberIds.length === 0) {
        await ctx.reply("Bu oy uchun ma'lumot topilmadi.");
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

export function reportController(bot: Bot<MyContext>) {
    bot.hears("📊 Hisobot", async (ctx) => {
        if (!ctx.from) return;

        const member = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!member) {
            await ctx.reply("Siz ro'yxatdan o'tmagansiz.");
            return;
        }

        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;

        const branchIds = await attendanceService.getBranchIdsForMemberAndMonth(member._id, year, month);

        if (branchIds.length === 0) {
            await ctx.reply("Sizda ushbu oy uchun hisobot mavjud emas.");
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
        const view = branchPickerView(branches, year, month, "personal_report");
        await ctx.reply(view.text, { reply_markup: view.keyboard });
    });

    bot.hears("📊 Filial hisoboti", async (ctx) => {
        if (!ctx.from) return;

        const member = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!member) return;

        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;

        if (hasManagerPermission(member)) {
            await sendBranchReport(ctx, member.branchId!, year, month);
        } else if (isBossOrAdmin(member)) {
            const view = branchPickerView(await branchService.getAllBranches(), year, month, "branch_report");
            await ctx.reply(view.text, { reply_markup: view.keyboard });
        } else {
            await ctx.reply("Sizda bu buyruq uchun ruxsat yo'q.");
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
        if (!isBossOrAdmin(member) && !isManagerOf(member, branchIdStr)) {
            await ctx.reply("Sizda bu buyruq uchun ruxsat yo'q.");
            return;
        }

        await sendBranchReport(ctx, new Types.ObjectId(branchIdStr), Number(year), Number(month));
    });

    bot.hears("🗂 Eski hisobotlar", async (ctx) => {
        if (!ctx.from) return;
        const member = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!member) return;

        const firstCheckIn = await attendanceService.getFirstCheckInDate(member._id);
        if (!firstCheckIn) {
            await ctx.reply("Sizda hali hech qanday hisobot yo'q.");
            return;
        }

        const now = new Date();
        const months = getMonthsBetween(
            firstCheckIn.getFullYear(), firstCheckIn.getMonth() + 1,
            now.getFullYear(), now.getMonth() + 1
        );

        if (months.length === 0) {
            await ctx.reply("Hali o'tgan oylar uchun hisobot mavjud emas.");
            return;
        }

        const view = monthPickerView(months);
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
            await ctx.reply("Bu oy uchun ma'lumot topilmadi.");
            return;
        }

        if (branchIds.length === 1) {
            const shifts = await attendanceService.getShiftsForMemberBranchAndMonth(member._id, branchIds[0], year, month);
            const buffer = await reportService.generateReportFile(member, shifts, year, month);
            await ctx.replyWithDocument(new InputFile(buffer, `${member.name}_${month}_${year}.xlsx`));
            return;
        }
        const branches = await branchService.getBranchesByIds(branchIds);
        const view = branchPickerView(branches, year, month, "personal_report");
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

