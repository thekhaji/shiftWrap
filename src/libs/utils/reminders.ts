import { Bot } from 'grammy';
import { MyContext } from '../../server';
import AttendanceModel from '../../schema/Attendance.model';
import MemberService from '../../models/Member.service';
import { DEFAULT_LANG, t } from '../i18n';
import { nowInSeoul } from './time';

const CHECK_EVERY_MS = 10 * 60 * 1000;
const REMIND_AFTER_MS = 12 * 60 * 60 * 1000;

const memberService = new MemberService();

// One reminder per forgotten check-out: shifts still open after 12 hours.
export function startCheckoutReminders(bot: Bot<MyContext>) {
    async function run() {
        try {
            const cutoff = new Date(nowInSeoul().getTime() - REMIND_AFTER_MS);
            const open = await AttendanceModel
                .find({ checkOut: { $exists: false }, reminderSentAt: { $exists: false }, checkIn: { $lt: cutoff } })
                .lean();
            for (const shift of open) {
                // claim it first, so a restart or a second instance can't send it twice
                const claimed = await AttendanceModel.updateOne(
                    { _id: shift._id, reminderSentAt: { $exists: false } },
                    { $set: { reminderSentAt: new Date() } }
                );
                if (claimed.modifiedCount === 0) continue;
                const member = await memberService.getMemberById(shift.memberId);
                if (!member) continue;
                await bot.api.sendMessage(member.telegramId, t(member.language ?? DEFAULT_LANG, 'reminder.checkout'))
                    .catch((err) => console.error(`checkout reminder to ${member.telegramId} failed:`, err));
            }
        } catch (err) {
            console.error("checkout reminder run failed:", err);
        }
    }

    run();
    setInterval(run, CHECK_EVERY_MS).unref();
}
