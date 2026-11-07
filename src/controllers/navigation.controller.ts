import { Bot } from 'grammy';
import { MyContext } from '../server';
import MemberService from '../models/Member.service';
import { backToMenuView } from '../views/index';
import { allLabels, allMenuLabels, t } from '../libs/i18n';
import { Member, MenuPanel } from '../libs/types/member';
import { hasManagerPermission, isAdmin } from '../libs/utils/permission';

const memberService = new MemberService();

// Every reply-keyboard button. Tapping one abandons whatever free-text/location prompt
// is pending, so the button's own label is never consumed as the answer to that prompt.
const MENU_BUTTONS = allMenuLabels();

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
            ctx.session.submitReport = undefined;
            ctx.session.expressProduct = undefined;
            ctx.session.editProduct = undefined;
            ctx.session.addProduct = undefined;
            ctx.session.expressOrder = undefined;
        }
        return next();
    });

    // managers switch between the employee and manager menus, admins between the admin and boss menus
    const switches: [Parameters<typeof allLabels>[0], MenuPanel, (m: Member) => boolean][] = [
        ['menu.managerPanel', 'MANAGER', hasManagerPermission],
        ['menu.employeePanel', 'EMPLOYEE', hasManagerPermission],
        ['menu.bossPanel', 'BOSS', isAdmin],
        ['menu.adminPanel', 'ADMIN', isAdmin],
    ];
    for (const [label, panel, allowed] of switches) {
        bot.hears(allLabels(label), async (ctx) => {
            if (!ctx.from) return;
            const member = await memberService.getMemberByTelegramId(ctx.from.id);
            if (!member || !allowed(member)) {
                await ctx.reply(t(ctx.lang, 'common.noPermission'));
                return;
            }
            const view = await backToMenuView(await memberService.setPanel(member.telegramId, panel));
            await ctx.reply(view.text, { reply_markup: view.keyboard });
        });
    }

    bot.hears(allLabels('menu.home'), async (ctx) => {
        if (!ctx.from) return;

        const member = await memberService.getMemberByTelegramId(ctx.from.id);
        const view = await backToMenuView(member ?? undefined);
        await ctx.reply(view.text, { reply_markup: view.keyboard });
    });
}
