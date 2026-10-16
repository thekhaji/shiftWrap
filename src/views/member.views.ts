import { Keyboard, InlineKeyboard } from "grammy";
import { Member } from "../libs/types/member";
import { Lang, t } from "../libs/i18n";


export function askPhoneView(lang: Lang) {
    return {
        text: t(lang, 'reg.askPhone'),
        keyboard: new Keyboard()
            .requestContact(t(lang, 'reg.sendPhone'))
            .resized()
            .oneTime(),
    };
}

export function userPickerView(lang: Lang, users: Member[]) {
    const keyboard = new InlineKeyboard();
    const sortedUsers = users.sort((a, b) => a.name.localeCompare(b.name));
    for (const user of sortedUsers) {
        keyboard.text(user.name, `user_picker:${user.telegramId.toString()}`).row();
    }
    return {
        text: t(lang, 'emp.pick'),
        keyboard,
    };
}

export function userEditView(lang: Lang, user: Member, branchName: string | null) {
    const keyboard = new InlineKeyboard()
        .text(t(lang, 'emp.btnPhone'), `edit_user:${user.telegramId},phone`).row()
        .text(t(lang, 'emp.btnBankName'), `edit_user:${user.telegramId},bankName`).row()
        .text(t(lang, 'emp.btnBankAccount'), `edit_user:${user.telegramId},bankAccount`).row()
        .text(t(lang, 'emp.btnRate'), `edit_user:${user.telegramId},hourlyRate`).row();

    const unknown = t(lang, 'common.unknown');
    return {
        text: t(lang, 'emp.card', {
            name: user.name,
            phone: user.phone,
            branch: branchName || unknown,
            bank: user.bankName || unknown,
            account: user.bankAccount || unknown,
            rate: user.hourlyRate !== undefined ? t(lang, 'emp.rate', { n: user.hourlyRate }) : unknown,
        }),
        keyboard,
    };
}

export function askEditFieldDetailView(lang: Lang, userName: string, field: string) {
    const keys = {
        phone: 'emp.ask.phone',
        bankName: 'emp.ask.bankName',
        bankAccount: 'emp.ask.bankAccount',
        hourlyRate: 'emp.ask.hourlyRate',
    } as const;
    const key = keys[field as keyof typeof keys];
    return {
        text: key ? t(lang, key, { name: userName }) : "",
        keyboard: new Keyboard()
            .text(t(lang, 'menu.home'))
            .resized()
            .oneTime(),
    };
}
