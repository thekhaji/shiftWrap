import { Bot } from 'grammy';
import { MyContext } from '../server';
import MemberService from '../models/Member.service';
import { backToMenuView } from '../views/index';

const memberService = new MemberService();

// Every reply-keyboard button. Tapping one abandons whatever free-text/location prompt
// is pending, so the button's own label is never consumed as the answer to that prompt.
const MENU_BUTTONS = new Set([
    "✅ Check In",
    "🚪 Check Out",
    "📊 Hisobot",
    "🧹 Haftalik tozalash",
    "🧼 Tozalash nazorati",
    "🗂 Eski hisobotlar",
    "🏢 Filial qo'shish",
    "👔 Filialga boshqaruvchi tayinlash",
    "📊 Filial hisoboti",
    "👥 Xodimlar ma'lumotlarini sozlash",
    "🔙 Bosh menyu",
]);

export function navigationController(bot: Bot<MyContext>) {
    // must be registered before any controller that reads session.awaitingAction
    bot.on("message:text", async (ctx, next) => {
        if (MENU_BUTTONS.has(ctx.message.text)) {
            ctx.session.awaitingAction = undefined;
            ctx.session.awaitingSince = undefined;
            ctx.session.pendingBranchName = undefined;
            ctx.session.editingMemberTelegramId = undefined;
            ctx.session.editingField = undefined;
            ctx.session.cleaning = undefined;
        }
        return next();
    });

    bot.hears("🔙 Bosh menyu", async (ctx) => {
        if (!ctx.from) return;

        const member = await memberService.getMemberByTelegramId(ctx.from.id);
        const view = backToMenuView(member ?? undefined);
        await ctx.reply(view.text, { reply_markup: view.keyboard });
    });
}
