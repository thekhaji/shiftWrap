import { InlineKeyboard } from 'grammy';
import { Lang, t } from '../libs/i18n';
import { Branch } from '../libs/types/branch';
import { Member } from '../libs/types/member';
import { ExpressOrder, ExpressProduct, QtyItem } from '../libs/types/express';
import { ExpressOrderStatus, ExpressType } from '../libs/enums/express.enum';
import { listText, money, orderTotal, withQty } from '../libs/utils/expressMath';

export const typeName = (lang: Lang, type: ExpressType) => t(lang, `express.${type}`);

// DD.MM + weekday of a stored Seoul day (UTC getters, like every stored date)
export function dayLabel(lang: Lang, date: Date): string {
    const weekdays = t(lang, 'weekdays').split(',');
    const dd = String(date.getUTCDate()).padStart(2, '0');
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    return `${dd}.${mm} ${weekdays[date.getUTCDay()]}`;
}

const short = (text: string, max = 22) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

// ---------------- admin: Express settings ----------------

// home: the two Express branches (or the buttons to choose them) and the access list
export function expressSettingsView(lang: Lang, held: Partial<Record<ExpressType, Branch>>, drivers: Member[]) {
    const keyboard = new InlineKeyboard();
    const lines: string[] = [];
    for (const type of Object.values(ExpressType)) {
        const holder = held[type];
        lines.push(`${typeName(lang, type)}: ${holder ? holder.name : t(lang, 'bx.none')}`);
        if (holder) keyboard.text(`⚙️ ${typeName(lang, type)} · ${short(holder.name)}`, `xs_b:${holder._id.toString()}`).row();
        else keyboard.text(t(lang, 'xs.choose', { type: typeName(lang, type) }), `xs_pick:${type}`).row();
    }
    keyboard.text(t(lang, 'xs.access'), 'xs_acc').row();
    keyboard.text(t(lang, 'xs.inviteDriver'), 'xs_inv').row();
    if (drivers.length) keyboard.text(t(lang, 'xs.drivers'), 'xs_d').row();
    keyboard.text(t(lang, 'xs.reports'), 'xs_rep');
    lines.push(`${t(lang, 'xs.driversLine')}: ${drivers.length ? drivers.map(d => d.name).join(', ') : t(lang, 'bx.none')}`);
    return { text: `${t(lang, 'xs.title')}\n\n${lines.join('\n')}`, keyboard };
}

// choose which branch becomes the Express branch of this type
export function expressTypePickerView(lang: Lang, type: ExpressType, candidates: Branch[]) {
    const keyboard = new InlineKeyboard();
    for (const b of candidates) keyboard.text(b.name, `bx_t:${b._id.toString()}:${type}`).row();
    keyboard.text(t(lang, 'bs.backShort'), 'xs_home');
    return { text: `${t(lang, 'xs.pickTitle', { type: typeName(lang, type) })}${candidates.length ? '' : `\n\n${t(lang, 'xs.noCandidates')}`}`, keyboard };
}

// one Express branch: its group, its drivers, its products
export function expressBranchView(lang: Lang, branch: Branch, groupName: string | undefined) {
    const id = branch._id.toString();
    const keyboard = new InlineKeyboard()
        .text(t(lang, 'xs.group'), `xs_g:${id}`).row();
    keyboard
        .text(t(lang, 'bx.products'), `bx_p:${id}`).row()
        .text(t(lang, 'bx.notExpress'), `bx_t:${id}:NONE`).row()
        .text(t(lang, 'bs.backShort'), 'xs_home');
    const text = t(lang, 'xs.branchTitle', {
        type: branch.express ? typeName(lang, branch.express) : '',
        branch: branch.name,
        group: groupName ?? t(lang, 'bs.groupNone'),
    });
    return { text, keyboard };
}

export function expressGroupPickerView(lang: Lang, branch: Branch, current: string | undefined, groups: { chatId: number; title: string }[]) {
    const id = branch._id.toString();
    const keyboard = new InlineKeyboard();
    if (branch.expressGroupId !== undefined) keyboard.text(t(lang, 'bs.groupRemove'), `xs_gr:${id}`).row();
    for (const g of groups) keyboard.text(g.title, `xs_gs:${id}:${g.chatId}`).row();
    keyboard.text(t(lang, 'bs.groupRefresh'), `xs_g:${id}`).row();
    keyboard.text(t(lang, 'bs.backShort'), `xs_b:${id}`);
    const header = t(lang, 'xs.groupTitle', { branch: branch.name, current: current ?? t(lang, 'bs.groupNone') });
    return { text: `${header}\n\n${t(lang, groups.length ? 'xs.groupPick' : 'xs.groupNoList')}`, keyboard };
}

export function expressDriversView(lang: Lang, drivers: Member[]) {
    const keyboard = new InlineKeyboard();
    for (const d of drivers) keyboard.text(`❌ ${short(d.name, 28)}`, `xs_dr:${d._id.toString()}`).row();
    keyboard.text(t(lang, 'bs.backShort'), 'xs_home');
    return { text: t(lang, 'xs.driversTitle'), keyboard };
}

// every branch that is not Express, with the Express branch it may order from
export function expressAccessListView(lang: Lang, branches: Branch[], expressBranches: Branch[]) {
    const keyboard = new InlineKeyboard();
    for (const b of branches) {
        const supplier = b.expressSupplierId ? expressBranches.find(e => e._id.equals(b.expressSupplierId!)) : undefined;
        const label = supplier?.express ? `✅ ${short(b.name, 18)} → ${typeName(lang, supplier.express)}` : short(b.name, 28);
        keyboard.text(label, `xs_ab:${b._id.toString()}`).row();
    }
    keyboard.text(t(lang, 'bs.backShort'), 'xs_home');
    const text = `${t(lang, 'xs.accessTitle')}${expressBranches.length === 0 ? `\n\n${t(lang, 'bx.noExpressYet')}` : branches.length === 0 ? `\n\n${t(lang, 'branch.none')}` : ''}`;
    return { text, keyboard };
}

// which Express branch one branch may order from
export function expressAccessView(lang: Lang, branch: Branch, expressBranches: Branch[], supplier?: Branch) {
    const id = branch._id.toString();
    const keyboard = new InlineKeyboard();
    for (const eb of expressBranches) {
        const chosen = branch.expressSupplierId?.equals(eb._id);
        keyboard.text(`${chosen ? '✅ ' : ''}${t(lang, 'bx.accessFor', { type: typeName(lang, eb.express!) })}`, `bx_s:${id}:${eb._id.toString()}`).row();
    }
    if (supplier) keyboard.text(t(lang, 'bx.removeAccess'), `bx_s:${id}:NONE`).row();
    keyboard.text(t(lang, 'bs.backShort'), 'xs_acc');
    const text = t(lang, 'xs.accessBranch', {
        branch: branch.name,
        supplier: supplier?.express ? `${typeName(lang, supplier.express)} (${supplier.name})` : t(lang, 'bx.none'),
    });
    return { text, keyboard };
}

// what the driver gets for every new order
export function expressDriverView(lang: Lang, order: ExpressOrder, names: { from: string; to: string }) {
    const text = t(lang, 'xs.driverOrder', {
        from: names.from, to: names.to, date: dayLabel(lang, order.neededDate),
        list: listText(order.items, false),
    });
    return { text };
}

export function expressProductsView(lang: Lang, branch: Branch, products: ExpressProduct[]) {
    const id = branch._id.toString();
    const keyboard = new InlineKeyboard();
    for (const p of products) keyboard.text(`${short(p.name, 28)} · ${money(p.price)}`, `bx_pe:${id},${p._id.toString()}`).row();
    keyboard.text(t(lang, 'xp.add'), `bx_pa:${id}`).row();
    keyboard.text(t(lang, 'bs.backShort'), `bx_e:${id}`);
    const text = `${t(lang, 'xp.title', { branch: branch.name })}${products.length ? '' : `\n\n${t(lang, 'xp.empty')}`}`;
    return { text, keyboard };
}

export function expressProductCardView(lang: Lang, product: ExpressProduct) {
    const keyboard = new InlineKeyboard()
        .text(t(lang, 'xp.btnPrice'), `bx_pp:${product._id.toString()}`).row()
        .text(t(lang, 'xp.btnDelete'), `bx_pd:${product._id.toString()}`).row()
        .text(t(lang, 'bs.backShort'), `bx_p:${product.expressBranchId.toString()}`);
    return { text: t(lang, 'xp.card', { name: product.name, price: money(product.price) }), keyboard };
}

// ---------------- ordering (manager / assistant of a branch with access) ----------------

export const PICK_PAGE_SIZE = 8;

export function expressPickView(lang: Lang, supplierName: string, products: ExpressProduct[], qty: Record<string, number>, page: number) {
    const pages = Math.max(1, Math.ceil(products.length / PICK_PAGE_SIZE));
    const current = Math.min(Math.max(0, page), pages - 1);
    const keyboard = new InlineKeyboard();
    for (const p of products.slice(current * PICK_PAGE_SIZE, (current + 1) * PICK_PAGE_SIZE)) {
        const id = p._id.toString();
        keyboard
            .text('➖', `xo_q:${id},m,${current}`)
            .text(`${short(p.name)} · ${money(p.price)} × ${qty[id] ?? 0}`, 'xo_i')
            .text('➕', `xo_q:${id},p,${current}`)
            .row();
    }
    if (pages > 1) {
        keyboard
            .text('◀', `xo_pg:${Math.max(0, current - 1)}`)
            .text(`${current + 1}/${pages}`, 'xo_i')
            .text('▶', `xo_pg:${Math.min(pages - 1, current + 1)}`)
            .row();
    }
    keyboard.text(t(lang, 'xo.continue'), 'xo_next').text(t(lang, 'common.cancel'), 'xo_cancel');
    const total = products.reduce((sum, p) => sum + p.price * (qty[p._id.toString()] ?? 0), 0);
    return { text: t(lang, 'xo.pick', { supplier: supplierName, total: money(total) }), keyboard };
}

export function expressDateView(lang: Lang, days: Date[]) {
    const keyboard = new InlineKeyboard();
    days.forEach((day, i) => {
        const key = `${day.getUTCFullYear()}${String(day.getUTCMonth() + 1).padStart(2, '0')}${String(day.getUTCDate()).padStart(2, '0')}`;
        keyboard.text(dayLabel(lang, day), `xo_d:${key}`);
        if (i % 2 === 1) keyboard.row();
    });
    keyboard.row().text(t(lang, 'xo.changeItems'), 'xo_pg:0').text(t(lang, 'common.cancel'), 'xo_cancel');
    return { text: t(lang, 'xo.pickDate'), keyboard };
}

export function expressReviewView(lang: Lang, supplierName: string, date: Date, lines: { name: string; price: number; qty: number }[]) {
    const keyboard = new InlineKeyboard()
        .text(t(lang, 'xo.submit'), 'xo_submit').row()
        .text(t(lang, 'xo.changeDate'), 'xo_next').text(t(lang, 'xo.changeItems'), 'xo_pg:0').row()
        .text(t(lang, 'common.cancel'), 'xo_cancel');
    const list = lines.map((l, n) => `${n + 1}. ${l.name} × ${l.qty} — ${money(l.price * l.qty)}`).join('\n');
    return { text: t(lang, 'xo.review', { supplier: supplierName, date: dayLabel(lang, date), list, total: money(orderTotal(lines)) }), keyboard };
}

// ---------------- the Express branch ----------------

// what the Express manager and assistants receive; Tag employee stays until it is sent
export function expressNoticeView(lang: Lang, order: ExpressOrder, d: { branch: string; requester: string; responsible?: string }) {
    const keyboard = new InlineKeyboard();
    if (order.status === ExpressOrderStatus.NEW || order.status === ExpressOrderStatus.ASSIGNED) {
        keyboard.text(t(lang, 'xe.tag'), `xe_tag:${order._id.toString()}`);
    }
    let text = t(lang, 'xe.new', {
        branch: d.branch, name: d.requester, date: dayLabel(lang, order.neededDate),
        list: listText(order.items), total: money(orderTotal(order.items)),
    });
    if (d.responsible) text += `\n\n${t(lang, 'xe.responsible', { name: d.responsible })}`;
    return { text, keyboard };
}

export function expressStaffPickerView(lang: Lang, order: ExpressOrder, staff: Member[]) {
    const keyboard = new InlineKeyboard();
    for (const m of staff) keyboard.text(m.name, `xe_who:${order._id.toString()},${m._id.toString()}`).row();
    return { text: t(lang, 'xe.pickWho'), keyboard };
}

// what the tagged employee receives
export function expressTaskView(lang: Lang, order: ExpressOrder, branchName: string) {
    const id = order._id.toString();
    const keyboard = new InlineKeyboard()
        .text(t(lang, 'xe.btnFull'), `xe_full:${id}`).row()
        .text(t(lang, 'xe.btnChange'), `xe_chg:${id}`);
    return {
        text: t(lang, 'xe.task', { branch: branchName, date: dayLabel(lang, order.neededDate), list: listText(order.items) }),
        keyboard,
    };
}

// +/- editor used twice: the Express employee sets what is sent, the ordering manager what was received
export function expressQtyEditorView(lang: Lang, order: ExpressOrder, draft: QtyItem[], stage: 'send' | 'receive', branchName: string) {
    const id = order._id.toString();
    const items = withQty(order.items, draft);
    const keyboard = new InlineKeyboard();
    for (const item of items) {
        const pid = item.productId.toString();
        keyboard
            .text('➖', `xq:${id},${pid},m`)
            .text(`${short(item.name)} × ${item.qty}`, 'xo_i')
            .text('➕', `xq:${id},${pid},p`)
            .row();
    }
    keyboard.text(t(lang, stage === 'send' ? 'xe.btnSent' : 'xc.btnConfirm'), `xdone:${id}`);
    const list = listText(items, false, true);
    return { text: t(lang, stage === 'send' ? 'xe.editTitle' : 'xc.editTitle', { branch: branchName, list }), keyboard };
}

// the next-day question to the ordering branch
export function expressConfirmView(lang: Lang, order: ExpressOrder, d: { supplier: string; sender: string }) {
    const id = order._id.toString();
    const sent = withQty(order.items, order.sentItems);
    const keyboard = new InlineKeyboard()
        .text(t(lang, 'xc.btnOk'), `xc_ok:${id}`).row()
        .text(t(lang, 'xc.btnChange'), `xc_chg:${id}`);
    return { text: t(lang, 'xc.ask', { supplier: d.supplier, name: d.sender, list: listText(sent), total: money(orderTotal(sent)) }), keyboard };
}

// ---------------- admin report (inside Express settings) ----------------

export function expressReportTypeView(lang: Lang, expressBranches: Branch[]) {
    const keyboard = new InlineKeyboard();
    for (const b of expressBranches) keyboard.text(`${typeName(lang, b.express!)} (${b.name})`, `xr_e:${b.express}`).row();
    keyboard.text(t(lang, 'bs.backShort'), 'xs_home');
    return { text: t(lang, 'xr.pickExpress'), keyboard };
}

export function expressReportBranchView(lang: Lang, type: ExpressType, branches: Branch[]) {
    const keyboard = new InlineKeyboard().text(t(lang, 'xr.allBranches'), `xr_b:${type},ALL`).row();
    for (const b of branches) keyboard.text(b.name, `xr_b:${type},${b._id.toString()}`).row();
    keyboard.text(t(lang, 'bs.backShort'), 'xs_rep');
    return { text: t(lang, 'xr.pickBranch', { type: typeName(lang, type) }), keyboard };
}

// one button per month that has confirmed orders, newest first
export function expressReportMonthView(lang: Lang, type: ExpressType, scope: string, months: { year: number; month: number }[], names: string[]) {
    const keyboard = new InlineKeyboard();
    for (const m of months) keyboard.text(`${names[m.month - 1]} ${m.year}`, `xr_m:${type},${scope},${m.year}-${String(m.month).padStart(2, '0')}`).row();
    keyboard.text(t(lang, 'bs.backShort'), `xr_e:${type}`);
    return { text: t(lang, 'xr.pickMonth'), keyboard };
}
