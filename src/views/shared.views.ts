import { Keyboard, InlineKeyboard } from "grammy";
import { Member } from "../libs/types/member";
import { hasManagerPermission } from "../libs/utils/permission";
import { DEFAULT_LANG, LANGUAGES, LANGUAGE_NAMES, Lang, t } from "../libs/i18n";

function mainMenuKeyboard(member?: Member) {
    const lang = member?.language ?? DEFAULT_LANG;

    if (member?.type === "BOSS" || member?.type === "ADMIN") {
        const bossKeyboard = new Keyboard()
            .text(t(lang, 'menu.addBranch'))
            .row()
            .text(t(lang, 'menu.branchReport'))
            .row();
        if (member.type === "BOSS") bossKeyboard.text(t(lang, 'menu.assignManager')).row();
        if (member.type === "ADMIN") {
            bossKeyboard.text(t(lang, 'menu.addProduct')).row();
            bossKeyboard.text(t(lang, 'menu.branchSettings')).row();
        }
        return bossKeyboard.text(t(lang, 'menu.language')).resized().persistent();
    }

    const employeeKeyboard = new Keyboard()
        .text(t(lang, 'menu.checkIn'))
        .text(t(lang, 'menu.checkOut'))
        .row()
        .text(t(lang, 'menu.report'))
        .row()
        .text(t(lang, 'menu.cleaning'))
        .row()
        .text(t(lang, 'menu.history'));

    if (member && hasManagerPermission(member)) {
        employeeKeyboard.row().text(t(lang, 'menu.storage'));
        employeeKeyboard.row().text(t(lang, 'menu.cleaningControl'));
        employeeKeyboard.row().text(t(lang, 'menu.branchReport'));
        employeeKeyboard.row().text(t(lang, 'menu.employees'));
    }

    return employeeKeyboard.row().text(t(lang, 'menu.language')).resized().persistent();
}

export function mainMenuView(member: Member) {
    return {
        text: t(member.language ?? DEFAULT_LANG, 'common.welcome', { name: member.name }),
        keyboard: mainMenuKeyboard(member),
    };
}

export function backToMenuView(member?: Member) {
    return {
        text: t(member?.language ?? DEFAULT_LANG, 'common.home'),
        keyboard: mainMenuKeyboard(member),
    };
}

export function menuUpdatedView(member: Member) {
    return {
        text: t(member.language ?? DEFAULT_LANG, 'common.menuUpdated'),
        keyboard: mainMenuKeyboard(member),
    };
}

export function errorView(lang: Lang) {
    return { text: t(lang, 'common.error') };
}

// language names are shown in their own language, so the same picker works for everyone
export function languagePickerView(callbackPrefix: string) {
    const keyboard = new InlineKeyboard();
    for (const lang of LANGUAGES) {
        keyboard.text(LANGUAGE_NAMES[lang], `${callbackPrefix}:${lang}`).row();
    }
    return { text: t('uz', 'lang.choose'), keyboard };
}
