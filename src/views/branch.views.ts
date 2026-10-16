import { Keyboard, InlineKeyboard } from "grammy";
import { Branch } from "../libs/types/branch";
import { Member } from "../libs/types/member";
import { Lang, t } from "../libs/i18n";

export function askBranchNameView(lang: Lang) {
    return {
        text: t(lang, 'branch.askName'),
        keyboard: new Keyboard()
            .text(t(lang, 'menu.home'))
            .resized()
            .oneTime(),
    };
}

export function branchRegisteredView(lang: Lang, branch: Branch) {
    return {
        text: t(lang, 'branch.registered', { name: branch.name, lat: branch.lat, lng: branch.lng }),
    };
}

export function branchPickerView(lang: Lang, branches: Branch[], year: number, month: number, callbackPrefix: string) {
    const keyboard = new InlineKeyboard();
    for (const branch of branches) {
        keyboard.text(branch.name, `${callbackPrefix}:${branch._id.toString()},${year},${month}`).row();
    }
    return {
        text: t(lang, 'report.pickBranch', { month, year }),
        keyboard,
    };
}


// Boss/Admin: step 1 of appointing a branch manager
export function managerBranchPickerView(lang: Lang, branches: Branch[]) {
    const keyboard = new InlineKeyboard();
    for (const branch of branches) {
        keyboard.text(branch.name, `mgr_branch:${branch._id.toString()}`).row();
    }
    return { text: t(lang, 'mgr.pickBranch'), keyboard };
}

// step 2: pick the employee (boss/admin accounts are never candidates)
export function managerCandidatePickerView(lang: Lang, branch: Branch, candidates: Member[]) {
    const keyboard = new InlineKeyboard();
    for (const user of candidates) {
        keyboard.text(user.name, `mgr_user:${branch._id.toString()},${user.telegramId}`).row();
    }
    return { text: t(lang, 'mgr.pickUser', { branch: branch.name }), keyboard };
}
