import { Bot } from 'grammy';
import { MyContext } from '../server';
import AttendanceService from '../models/Attendance.service';
import { askLocationView } from '../views/index';
import Errors from '../libs/Errors';
import { allLabels, errorText, t } from '../libs/i18n';
import BranchService from '../models/Branch.service';

const attendanceService = new AttendanceService();
const branchService = new BranchService();

export function attendanceController(bot: Bot<MyContext>) {
    bot.hears(allLabels('menu.checkIn'), async (ctx) => {
        if (!ctx.from) return;
        ctx.session.awaitingAction = "checkin";
        ctx.session.awaitingSince = Date.now();
        const view = askLocationView(ctx.lang);
        await ctx.reply(view.text, { reply_markup: view.keyboard });
    });

    bot.hears(allLabels('menu.checkOut'), async (ctx) => {
        if (!ctx.from) return;
        ctx.session.awaitingAction = "checkout";
        ctx.session.awaitingSince = Date.now();
        const view = askLocationView(ctx.lang);
        await ctx.reply(view.text, { reply_markup: view.keyboard });
    });

    bot.on("message:location", async (ctx, next) => {
        if (!ctx.from) return;

        const action = ctx.session.awaitingAction;
        if (action !== "checkin" && action !== "checkout") return next();

        const since = ctx.session.awaitingSince ?? 0;
        const expired = Date.now() - since > 60_000;

        ctx.session.awaitingAction = undefined;
        ctx.session.awaitingSince = undefined;

        if (expired) {
            await ctx.reply(t(ctx.lang, 'common.timeout'));
            return;
        }

        const { latitude, longitude } = ctx.message.location;

        try {
            const nearestBranch = await branchService.findNearestBranch(latitude, longitude);
            if (action === "checkin") {
                const shift = await attendanceService.checkIn(ctx.from.id, nearestBranch.branch._id);
                await ctx.reply(t(ctx.lang, 'att.started', { time: new Date(shift.checkIn).toLocaleTimeString(undefined, { timeZone: 'UTC' }) }));
            } else {
                const shift = await attendanceService.checkOut(ctx.from.id, nearestBranch.branch._id);
                await ctx.reply(t(ctx.lang, 'att.ended', { time: new Date(shift.checkOut!).toLocaleTimeString(undefined, { timeZone: 'UTC' }) }));
            }
        } catch (err) {
            if (err instanceof Errors) {
                await ctx.reply(errorText(ctx.lang, err.message));
            } else {
                console.error("attendance error:", err);
                await ctx.reply(t(ctx.lang, 'common.errorShort'));
            }
        }
    });
}