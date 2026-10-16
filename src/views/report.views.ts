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
