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
