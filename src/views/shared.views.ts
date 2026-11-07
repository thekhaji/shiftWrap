import { Keyboard, InlineKeyboard } from "grammy";
import { Member } from "../libs/types/member";
import { hasManagerPermission, hasSalaryAccess } from "../libs/utils/permission";
import { branchHasExpress } from "../libs/utils/expressAccess";
import { DEFAULT_LANG, LANGUAGES, LANGUAGE_NAMES, Lang, t } from "../libs/i18n";

// a manager looks at the employee menu until they open the manager panel; an admin at the admin panel until they open the boss one
const managerPanelOf = (member: Member) => (member.panel === 'MANAGER' ? 'MANAGER' : 'EMPLOYEE');
const adminPanelOf = (member: Member) => (member.panel === 'BOSS' ? 'BOSS' : 'ADMIN');

// what a boss does (an admin sees the same in the boss panel)
function bossFeatures(keyboard: Keyboard, lang: Lang, assignManager: boolean) {
    keyboard.text(t(lang, 'menu.addBranch')).row();
    keyboard.text(t(lang, 'menu.branchReport')).row();
    keyboard.text(t(lang, 'menu.payroll')).text(t(lang, 'menu.payrollStatus')).row();
    keyboard.text(t(lang, 'menu.expressReport')).row();
    keyboard.text(t(lang, 'menu.requests')).row();
    if (assignManager) keyboard.text(t(lang, 'menu.assignManager')).row();
}

async function mainMenuKeyboard(member?: Member) {
    const lang = member?.language ?? DEFAULT_LANG;

    if (member?.type === "BOSS") {
        const keyboard = new Keyboard();
        bossFeatures(keyboard, lang, true);
        return keyboard.text(t(lang, 'menu.language')).resized().persistent();
    }

    if (member?.type === "ADMIN") {
        const keyboard = new Keyboard();
        if (adminPanelOf(member) === 'BOSS') {
            bossFeatures(keyboard, lang, false);
            keyboard.text(t(lang, 'menu.language')).row();
            return keyboard.text(t(lang, 'menu.adminPanel')).resized().persistent();
        }
        keyboard.text(t(lang, 'menu.employees')).row();
        keyboard.text(t(lang, 'menu.inviteBoss')).row();
        keyboard.text(t(lang, 'menu.storage')).row();
        keyboard.text(t(lang, 'menu.branchSettings')).row();
        keyboard.text(t(lang, 'menu.expressSettings')).row();
        keyboard.text(t(lang, 'menu.language')).row();
        return keyboard.text(t(lang, 'menu.bossPanel')).resized().persistent();
    }

    // a driver only receives Express orders: nothing to tap but the language
    if (member?.type === "DRIVER") return new Keyboard().text(t(lang, 'menu.language')).resized().persistent();

    // a manager or assistant: the manager panel holds the management features
    if (member && hasManagerPermission(member) && managerPanelOf(member) === 'MANAGER') {
        const keyboard = new Keyboard();
        keyboard.text(t(lang, 'menu.storage')).row();
        // only managers of a branch the admin gave Express access to
        if (await branchHasExpress(member.branchId)) keyboard.text(t(lang, 'menu.expressOrder')).row();
        keyboard.text(t(lang, 'menu.cleaningControl')).row();
        // the assistant never sees pay: no branch report, payroll or payroll status
        if (hasSalaryAccess(member)) {
            keyboard.text(t(lang, 'menu.branchReport')).row();
            keyboard.text(t(lang, 'menu.payroll')).text(t(lang, 'menu.payrollStatus')).row();
        }
        keyboard.text(t(lang, 'menu.requests')).row();
        keyboard.text(t(lang, 'menu.employees')).row();
        keyboard.text(t(lang, 'menu.language')).row();
        return keyboard.text(t(lang, 'menu.employeePanel')).resized().persistent();
    }

    const employeeKeyboard = new Keyboard()
        .text(t(lang, 'menu.checkIn'))
        .text(t(lang, 'menu.checkOut'))
        .row()
        .text(t(lang, 'menu.report'))
        .text(t(lang, 'menu.submitReport'))
        .row()
        .text(t(lang, 'menu.cleaning'))
        .row()
        .text(t(lang, 'menu.history'))
        .row()
        .text(t(lang, 'menu.language'));
    if (member && hasManagerPermission(member)) employeeKeyboard.row().text(t(lang, 'menu.managerPanel'));
    return employeeKeyboard.resized().persistent();
}

export async function mainMenuView(member: Member) {
    return {
        text: t(member.language ?? DEFAULT_LANG, 'common.welcome', { name: member.name }),
        keyboard: await mainMenuKeyboard(member),
    };
}

export async function backToMenuView(member?: Member) {
    return {
        text: t(member?.language ?? DEFAULT_LANG, 'common.home'),
        keyboard: await mainMenuKeyboard(member),
    };
}

export async function menuUpdatedView(member: Member) {
    return {
        text: t(member.language ?? DEFAULT_LANG, 'common.menuUpdated'),
        keyboard: await mainMenuKeyboard(member),
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
