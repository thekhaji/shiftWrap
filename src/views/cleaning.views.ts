import { InlineKeyboard } from 'grammy';
import { CleaningPlace, CLEANING_PLACE_LABELS } from '../libs/enums/cleaning.enum';

// employee: pick a place to upload a before/after pair for
export function cleaningPlacesView(donePlaces: Set<CleaningPlace>, note?: string) {
    const keyboard = new InlineKeyboard();
    for (const place of Object.values(CleaningPlace)) {
        keyboard.text(`${donePlaces.has(place) ? '✅ ' : ''}${CLEANING_PLACE_LABELS[place]}`, `clean_place:${place}`).row();
    }
    keyboard.text("✔️ Hammasi mendan", "clean_done");
    const text = "Qaysi joyni tozaladingiz? Joyni tanlab, tozalashdan oldingi va keyingi rasmlarni yuboring:";
    return { text: note ? `${note}\n\n${text}` : text, keyboard };
}

export function cleaningUploadView(place: CleaningPlace) {
    const keyboard = new InlineKeyboard().text("⬅️ Orqaga", "clean_back");
    return {
        text: `${CLEANING_PLACE_LABELS[place]}\nTozalashdan oldingi va keyingi rasmlarni BIRGA yuboring: 2 ta rasmni belgilab, bitta albom qilib jo'nating (1-rasm — oldingi, 2-rasm — keyingi).`,
        keyboard,
    };
}

// manager: overview of this week's uploaded pairs per place
export function cleaningOverviewView(counts: Map<CleaningPlace, number>, doneNames: string[]) {
    const keyboard = new InlineKeyboard();
    for (const place of Object.values(CleaningPlace)) {
        keyboard.text(`${CLEANING_PLACE_LABELS[place]} — ${counts.get(place) ?? 0} juft`, `clean_view:${place}`).row();
    }
    const done = doneNames.length ? `\n\nTugatganlar: ${doneNames.join(', ')}` : "";
    return { text: `🧼 Shu haftadagi tozalash rasmlari. Joyni tanlang — taqdimot tayyorlanadi.${done}`, keyboard };
}

export function cleaningSubmitView(place: CleaningPlace) {
    const keyboard = new InlineKeyboard().text("📤 Boss'ga yuborish", `clean_submit:${place}`);
    return { keyboard };
}
