import { InlineKeyboard } from 'grammy';
import { Lang, t } from '../libs/i18n';
import { Branch } from '../libs/types/branch';
import { Member } from '../libs/types/member';
import { ExpressProduct } from '../libs/types/express';
import { typeName } from './express.views';

export const GUEST_PAGE_SIZE = 8;
const short = (text: string, max = 24) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

const expressNames = (lang: Lang, guest: Pick<Branch, 'expressSupplierIds'>, expressBranches: Branch[]) => {
    const names = expressBranches.filter(e => guest.expressSupplierIds?.some(s => s.equals(e._id))).map(e => typeName(lang, e.express!));
    return names.length ? names.join(' + ') : t(lang, 'bx.none');
};

// the admin's list of guest restaurants
export function guestListView(lang: Lang, guests: Branch[], expressBranches: Branch[]) {
    const keyboard = new InlineKeyboard();
    for (const g of guests) keyboard.text(`${short(g.name, 22)} · ${expressNames(lang, g, expressBranches)}`, `gr_c:${g._id.toString()}`).row();
    keyboard.text(t(lang, 'gr.add'), 'gr_add').row().text(t(lang, 'bs.backShort'), 'xs_home');
    return { text: `${t(lang, 'gr.listTitle', { n: guests.length })}${guests.length ? '' : `\n\n${t(lang, 'gr.empty')}`}`, keyboard };
}

// tick the Express branches a guest may order from (creating a guest, or changing one)
export function guestAccessView(lang: Lang, name: string, expressBranches: Branch[], chosen: Set<string>, mode: { toggle: (supplierId: string) => string; done: string; doneLabel: string; title: 'gr.pickAccess' | 'gr.accessTitle'; cancel: string }) {
    const keyboard = new InlineKeyboard();
    for (const e of expressBranches) {
        const id = e._id.toString();
        keyboard.text(`${chosen.has(id) ? '✅' : '⬜'} ${typeName(lang, e.express!)} · ${short(e.name)}`, mode.toggle(id)).row();
    }
    keyboard.text(mode.doneLabel, mode.done).row().text(t(lang, 'common.cancel'), mode.cancel);
    return { text: t(lang, mode.title, { name }), keyboard };
}

// a page of the Express products with ticks
export function guestProductsView(lang: Lang, name: string, products: ExpressProduct[], supplierNames: Map<string, string>, chosen: Set<string>, page: number,
    cb: { toggle: (productId: string) => string; page: (n: number) => string; all: string; clear: string; done: string; doneLabel: string; back: string }) {
    const pages = Math.max(1, Math.ceil(products.length / GUEST_PAGE_SIZE));
    const current = Math.min(Math.max(0, page), pages - 1);
    const multi = new Set(products.map(p => p.expressBranchId.toString())).size > 1;
    const keyboard = new InlineKeyboard();
    keyboard.text(t(lang, 'gr.selectAll'), cb.all).text(t(lang, 'gr.clear'), cb.clear).row();
    for (const p of products.slice(current * GUEST_PAGE_SIZE, (current + 1) * GUEST_PAGE_SIZE)) {
        const id = p._id.toString();
        const where = multi ? ` · ${short(supplierNames.get(p.expressBranchId.toString()) ?? '', 10)}` : '';
        keyboard.text(`${chosen.has(id) ? '✅' : '⬜'} ${short(p.name, 24)}${where}`, cb.toggle(id)).row();
    }
    if (pages > 1) {
        if (current > 0) keyboard.text('◀', cb.page(current - 1));
        keyboard.text(`${current + 1}/${pages}`, 'gr_noop');
        if (current < pages - 1) keyboard.text('▶', cb.page(current + 1));
        keyboard.row();
    }
    keyboard.text(cb.doneLabel, cb.done).row().text(t(lang, 'bs.backShort'), cb.back);
    return { text: `${t(lang, 'gr.pickProducts', { name })}\n${chosen.size} / ${products.length}`, keyboard };
}

export function guestSummaryView(lang: Lang, name: string, express: string, n: number, total: number) {
    const keyboard = new InlineKeyboard().text(t(lang, 'gr.create'), 'gr_ok').row().text(t(lang, 'common.cancel'), 'gr_cancel');
    return { text: t(lang, 'gr.summary', { name, express, n, total }), keyboard };
}

// one guest: who owns it, what it may order, and the buttons to change that
export function guestCardView(lang: Lang, guest: Branch, owner: Member | null, expressBranches: Branch[], total: number) {
    const id = guest._id.toString();
    const keyboard = new InlineKeyboard()
        .text(t(lang, 'gr.btnRename'), `gr_rn:${id}`).text(t(lang, 'gr.btnAccess'), `gr_ea:${id}`).row()
        .text(t(lang, 'gr.btnProducts'), `gr_ep:${id},0`).row()
        .text(t(lang, owner ? 'gr.btnChangeOwner' : 'gr.btnNewLink'), owner ? `gr_co:${id}` : `gr_nl:${id}`).row()
        .text(t(lang, 'gr.btnRemove'), `gr_x:${id}`).row()
        .text(t(lang, 'bs.backShort'), 'gr_l');
    const text = t(lang, 'gr.card', {
        name: guest.name,
        owner: owner ? `${owner.name} · ${owner.phone}` : t(lang, 'gr.ownerNone'),
        express: expressNames(lang, guest, expressBranches),
        n: guest.guestProductIds?.length ?? 0,
        total,
    });
    return { text, keyboard };
}

export function guestConfirmView(lang: Lang, text: string, yesLabel: string, yes: string, back: string) {
    const keyboard = new InlineKeyboard().text(yesLabel, yes).text(t(lang, 'common.cancel'), back);
    return { text, keyboard };
}
