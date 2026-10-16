import { Keyboard } from "grammy";
import { Lang, t } from "../libs/i18n";

export function askLocationView(lang: Lang) {
    return {
        text: t(lang, 'att.askLocation'),
        keyboard: new Keyboard()
            .requestLocation(t(lang, 'att.sendLocation'))
            .row()
            .text(t(lang, 'menu.home'))
            .resized()
            .oneTime(),
    };
}

export function checkInSuccessView(lang: Lang, checkInTime: Date) {
    return { text: t(lang, 'att.checkInOk', { time: checkInTime.toLocaleString() }) };
}

export function checkOutSuccessView(lang: Lang, checkInTime: Date, checkOutTime: Date) {
    return {
        text: t(lang, 'att.checkOutOk', { inTime: checkInTime.toLocaleString(), outTime: checkOutTime.toLocaleString() }),
    };
}

export function noOpenShiftView(lang: Lang) {
    return { text: t(lang, 'att.noOpenShift') };
}
