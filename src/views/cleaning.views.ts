import { InlineKeyboard } from 'grammy';
import { CleaningPlace, CLEANING_OTHERS, CLEANING_OTHERS_KEY, CLEANING_SEPARATE } from '../libs/enums/cleaning.enum';
import { Lang, t } from '../libs/i18n';

// employee: pick a place to upload a before/after pair for
export function cleaningPlacesView(lang: Lang, donePlaces: Set<CleaningPlace>, note?: string) {
    const keyboard = new InlineKeyboard();
    for (const place of Object.values(CleaningPlace)) {
        keyboard.text(`${donePlaces.has(place) ? '✅ ' : ''}${t(lang, `place.${place}`)}`, `clean_place:${place}`).row();
    }
    keyboard.text(t(lang, 'clean.finish'), "clean_done");
    const text = t(lang, 'clean.places');
    return { text: note ? `${note}\n\n${text}` : text, keyboard };
}

export function cleaningUploadView(lang: Lang, place: CleaningPlace) {
    const keyboard = new InlineKeyboard().text(t(lang, 'clean.back'), "clean_back");
    return { text: t(lang, 'clean.upload', { place: t(lang, `place.${place}`) }), keyboard };
}

// manager: overview of this week's uploaded pairs per place
export function cleaningOverviewView(lang: Lang, counts: Map<CleaningPlace, number>, doneNames: string[]) {
    const keyboard = new InlineKeyboard();
    // Hall + Kitchen + Prep arrive as one deck; Office and Home each have their own
    const others = CLEANING_OTHERS.reduce((sum, p) => sum + (counts.get(p) ?? 0), 0);
    keyboard.text(t(lang, 'clean.pairs', { place: t(lang, 'place.OTHERS'), n: others }), `clean_view:${CLEANING_OTHERS_KEY}`).row();
    for (const place of CLEANING_SEPARATE) {
        keyboard.text(t(lang, 'clean.pairs', { place: t(lang, `place.${place}`), n: counts.get(place) ?? 0 }), `clean_view:${place}`).row();
    }
    const done = doneNames.length ? `\n\n${t(lang, 'clean.finishedList', { names: doneNames.join(', ') })}` : "";
    return { text: `🧼 ${t(lang, 'clean.overview')}${done}`, keyboard };
}

export function cleaningSubmitView(lang: Lang, place: CleaningPlace | typeof CLEANING_OTHERS_KEY) {
    const keyboard = new InlineKeyboard().text(t(lang, 'clean.submit'), `clean_submit:${place}`);
    return { keyboard };
}
