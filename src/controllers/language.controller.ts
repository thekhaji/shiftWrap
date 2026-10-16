import { Bot } from 'grammy';
import { MyContext } from '../server';
import MemberService from '../models/Member.service';
import { allLabels, isLang, t } from '../libs/i18n';
import { askPhoneView, languagePickerView, mainMenuView } from '../views/index';

const memberService = new MemberService();

export function languageController(bot: Bot<MyContext>) {
    // registration: the first thing a new user does is pick a language
    bot.callbackQuery(/^reg_lang:/, async (ctx) => {
        const lang = ctx.callbackQuery.data.split(':')[1];
        if (!isLang(lang)) {
            await ctx.answerCallbackQuery();
            return;
        }
        ctx.session.lang = lang;
        ctx.lang = lang;
        await ctx.answerCallbackQuery();
        const view = askPhoneView(lang);
        await ctx.reply(view.text, { reply_markup: view.keyboard });
    });

    // registered users can change it any time from the main menu
    bot.hears(allLabels('menu.language'), async (ctx) => {
        const view = languagePickerView('set_lang');
        await ctx.reply(view.text, { reply_markup: view.keyboard });
    });

    bot.callbackQuery(/^set_lang:/, async (ctx) => {
        const lang = ctx.callbackQuery.data.split(':')[1];
        const existing = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!existing || !isLang(lang)) {
            await ctx.answerCallbackQuery();
            return;
        }
        const member = await memberService.setLanguage(existing.telegramId, lang);
        ctx.lang = lang;
        await ctx.answerCallbackQuery();
        await ctx.editMessageText(t(lang, 'lang.changed'));
        const menu = mainMenuView(member); // reply keyboards only change when we send a new one
        await ctx.reply(menu.text, { reply_markup: menu.keyboard });
    });
}
