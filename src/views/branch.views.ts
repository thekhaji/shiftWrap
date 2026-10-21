import { Keyboard, InlineKeyboard } from "grammy";
import { Branch } from "../libs/types/branch";
import { Member } from "../libs/types/member";
import { Product } from "../libs/types/product";
import { MAX_MANAGERS_PER_BRANCH } from "../models/Member.service";
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


export const SETTINGS_PAGE_SIZE = 10;

// Admin: step 1 of branch settings
export function settingsBranchPickerView(lang: Lang, branches: Branch[]) {
    const keyboard = new InlineKeyboard();
    for (const branch of branches) {
        keyboard.text(branch.name, `bs_b:${branch._id.toString()}`).row();
    }
    return { text: t(lang, 'bs.pickBranch'), keyboard };
}

// step 2: the catalog, one toggle per product; ✅ = this branch storage may order it
export function branchProductAccessView(lang: Lang, branch: Branch, products: Product[], page: number) {
    const pages = Math.max(1, Math.ceil(products.length / SETTINGS_PAGE_SIZE));
    const current = Math.min(Math.max(page, 0), pages - 1);
    const granted = new Set((branch.productIds ?? []).map(id => id.toString()));
    const id = branch._id.toString();

    const keyboard = new InlineKeyboard();
    for (const p of products.slice(current * SETTINGS_PAGE_SIZE, (current + 1) * SETTINGS_PAGE_SIZE)) {
        const mark = granted.has(p._id.toString()) ? '✅' : '☐';
        keyboard.text(`${mark} ${p.name}`, `bs_t:${id}:${p._id.toString()}:${current}`).row();
    }
    if (pages > 1) {
        if (current > 0) keyboard.text('◀️', `bs_p:${id}:${current - 1}`);
        keyboard.text(`${current + 1}/${pages}`, 'bs_noop');
        if (current < pages - 1) keyboard.text('▶️', `bs_p:${id}:${current + 1}`);
        keyboard.row();
    }
    keyboard.text(t(lang, 'bs.backShort'), `bs_b:${id}`);
    return { text: t(lang, 'bs.title', { branch: branch.name, page: current + 1, pages }), keyboard };
}

// step 2: what to configure for this branch
export function branchSettingsMenuView(lang: Lang, branch: Branch) {
    const id = branch._id.toString();
    const keyboard = new InlineKeyboard()
        .text(t(lang, 'bs.products'), `bs_p:${id}:0`).row()
        .text(t(lang, 'bs.managers'), `bs_m:${id}`).row()
        .text(t(lang, 'bs.groups'), `bs_g:${id}`).row()
        .text(t(lang, 'bs.back'), 'bs_back');
    return { text: `${t(lang, 'bs.branchTitle', { branch: branch.name })}\n${t(lang, 'bs.menuText')}`, keyboard };
}

// current managers (tap to remove) + add button while there is room
export function branchManagersView(lang: Lang, branch: Branch, managers: Member[]) {
    const id = branch._id.toString();
    const keyboard = new InlineKeyboard();
    for (const m of managers) keyboard.text(`❌ ${m.name}`, `bs_mr:${id}:${m.telegramId}`).row();
    if (managers.length < MAX_MANAGERS_PER_BRANCH) keyboard.text(t(lang, 'bs.addManager'), `bs_ma:${id}`).row();
    keyboard.text(t(lang, 'bs.backShort'), `bs_b:${id}`);
    return {
        text: t(lang, 'bs.managersTitle', { branch: branch.name, count: managers.length, max: MAX_MANAGERS_PER_BRANCH }),
        keyboard,
    };
}

// candidates for the settings flow; the shared mgr_user handler does the assigning
export function settingsCandidatePickerView(lang: Lang, branch: Branch, candidates: Member[]) {
    const keyboard = new InlineKeyboard();
    for (const user of candidates) keyboard.text(user.name, `bs_mu:${branch._id.toString()}:${user.telegramId}`).row();
    keyboard.text(t(lang, 'bs.backShort'), `bs_m:${branch._id.toString()}`);
    return { text: t(lang, 'mgr.pickUser', { branch: branch.name }), keyboard };
}

export type GroupKind = 'o' | 'c';   // order / cleaning

// both groups and whether each is assigned
export function branchGroupsView(lang: Lang, branch: Branch, names: { order?: string; cleaning?: string }) {
    const id = branch._id.toString();
    const none = t(lang, 'bs.groupNone');
    const keyboard = new InlineKeyboard()
        .text(t(lang, 'bs.orderGroup'), `bs_gk:${id}:o`).row()
        .text(t(lang, 'bs.cleaningGroup'), `bs_gk:${id}:c`).row()
        .text(t(lang, 'bs.backShort'), `bs_b:${id}`);
    return {
        text: t(lang, 'bs.groupsTitle', { branch: branch.name, order: names.order ?? none, cleaning: names.cleaning ?? none }),
        keyboard,
    };
}

// one group kind: current group (or "not assigned"), remove button, and the groups the bot is admin in
export function branchGroupPickerView(lang: Lang, branch: Branch, kind: GroupKind, current: string | undefined, groups: { chatId: number; title: string }[]) {
    const id = branch._id.toString();
    const keyboard = new InlineKeyboard();
    if (current) keyboard.text(t(lang, 'bs.groupRemove'), `bs_gr:${id}:${kind}`).row();
    for (const g of groups) keyboard.text(g.title, `bs_gs:${id}:${kind}:${g.chatId}`).row();
    keyboard.text(t(lang, 'bs.groupRefresh'), `bs_gk:${id}:${kind}`).row();
    keyboard.text(t(lang, 'bs.backShort'), `bs_g:${id}`);
    const kindName = t(lang, kind === 'o' ? 'bs.orderGroup' : 'bs.cleaningGroup');
    const header = t(lang, 'bs.groupTitle', { kind: kindName, branch: branch.name, current: current ?? t(lang, 'bs.groupNone') });
    return { text: `${header}\n\n${t(lang, groups.length ? 'bs.groupPick' : 'bs.groupNoList')}`, keyboard };
}
