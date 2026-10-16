import { InlineKeyboard } from 'grammy';
import { CleaningPlace, CLEANING_PLACE_LABELS } from '../libs/enums/cleaning.enum';

// employee: pick a place to upload a before/after pair for
export function cleaningPlacesView(donePlaces: Set<CleaningPlace>, note?: string) {
    const keyboard = new InlineKeyboard();
    for (const place of Object.values(CleaningPlace)) {
        keyboard.text(`${donePlaces.has(place) ? '✅ ' : ''}${CLEANING_PLACE_LABELS[place]}`, `clean_place:${place}`).row();
    }
    keyboard.text("✔️ Yuklashni yakunlash", "clean_done");
    const text = "Tozalash o'tkazilgan hududni tanlang, so'ng shu hudud uchun tozalashdan oldingi va keyingi rasmlarni yuklang:";
    return { text: note ? `${note}\n\n${text}` : text, keyboard };
}

export function cleaningUploadView(place: CleaningPlace) {
    const keyboard = new InlineKeyboard().text("⬅️ Hududlar ro'yxatiga qaytish", "clean_back");
    return {
        text: `${CLEANING_PLACE_LABELS[place]}\nTozalashdan oldingi va keyingi rasmlarni bitta albom sifatida yuboring (jami 2 ta):\n1-rasm — tozalashdan oldin\n2-rasm — tozalashdan keyin`,
        keyboard,
    };
}

// manager: overview of this week's uploaded pairs per place
export function cleaningOverviewView(counts: Map<CleaningPlace, number>, doneNames: string[]) {
    const keyboard = new InlineKeyboard();
    for (const place of Object.values(CleaningPlace)) {
        keyboard.text(`${CLEANING_PLACE_LABELS[place]} — ${counts.get(place) ?? 0} ta juftlik`, `clean_view:${place}`).row();
    }
    const done = doneNames.length ? `\n\nYuklashni yakunlaganlar: ${doneNames.join(', ')}` : "";
    return { text: `🧼 Joriy hafta tozalash nazorati.\nTaqdimotni tayyorlash uchun hududni tanlang:${done}`, keyboard };
}

export function cleaningSubmitView(place: CleaningPlace) {
    const keyboard = new InlineKeyboard().text("📤 Rahbariyatga yuborish", `clean_submit:${place}`);
    return { keyboard };
}
