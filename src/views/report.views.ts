import { InlineKeyboard } from "grammy";
import { Lang, monthNames, t } from "../libs/i18n";

export function monthPickerView(lang: Lang, months: { year: number; month: number }[]) {
    const keyboard = new InlineKeyboard();
    const names = monthNames(lang);

    for (const { year, month } of months) {
        keyboard.text(`${names[month - 1]} ${year}`, `history_month:${year}-${month}`).row();
    }

    return { text: t(lang, 'report.pickMonth'), keyboard };
}

// boss/admin: payroll for one branch or for all of them
export function payrollScopePickerView(lang: Lang, branches: { _id: { toString(): string }; name: string }[]) {
    const keyboard = new InlineKeyboard().text(t(lang, 'payroll.allBranches'), 'payroll:ALL').row();
    for (const branch of branches) keyboard.text(branch.name, `payroll:${branch._id.toString()}`).row();
    return { text: t(lang, 'payroll.pickScope'), keyboard };
}

// a manager decides whether an employee's edits to their own report are applied
export function approvalRequestView(
    lang: Lang,
    d: { name: string; branch: string; month: number; year: number; before: string; after: string; lines: string[]; subId: string; revision: number }
) {
    const lines = d.lines.slice(0, 10);
    if (d.lines.length > lines.length) lines.push(`… +${d.lines.length - lines.length}`);
    const keyboard = new InlineKeyboard()
        .text(t(lang, 'sub.btnApprove'), `sub_ok:${d.subId}:${d.revision}`)
        .text(t(lang, 'sub.btnReject'), `sub_no:${d.subId}:${d.revision}`);
    const text = t(lang, 'sub.approvalAsk', {
        name: d.name, branch: d.branch, month: monthNames(lang)[d.month - 1], year: d.year,
        before: d.before, after: d.after, list: lines.join('\n'),
    });
    return { text: text.slice(0, 4000), keyboard };
}

export function payrollStatusView(
    lang: Lang,
    d: { branchId: string; branch: string; month: number; year: number; lines: string[]; done: number; total: number; closed: boolean; missing?: { id: string; name: string }[] }
) {
    const keyboard = new InlineKeyboard();
    // people who have not submitted: the manager can submit their recorded hours for them
    if (!d.closed) for (const m of d.missing ?? []) keyboard.text(t(lang, 'ps.forceBtn', { name: m.name }), `ps_force:${d.branchId},${m.id}`).row();
    if (d.closed) keyboard.text(t(lang, 'ps.reopen'), `ps_reopen:${d.branchId}`);
    const state = t(lang, d.closed ? 'ps.closed' : 'ps.open');
    const list = d.lines.length ? d.lines.join('\n') : t(lang, 'ps.empty');
    const text = `${t(lang, 'ps.title', { branch: d.branch, month: monthNames(lang)[d.month - 1], year: d.year, done: d.done, total: d.total, state })}\n\n${list}\n\n${t(lang, 'ps.legend')}`;
    return { text: text.slice(0, 4000), keyboard };
}
