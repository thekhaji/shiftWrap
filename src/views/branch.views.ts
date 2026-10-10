import { Keyboard, InlineKeyboard } from "grammy";
import { Branch } from "../libs/types/branch";

export function askBranchNameView() {
    return {
        text: "Yangi filial nomini kiriting ✍️",
        keyboard: new Keyboard()
            .text("🔙 Bosh menyu")
            .resized()
            .oneTime(),
    };
}

export function branchRegisteredView(branch: Branch) {
    return {
        text: `Filial muvaffaqiyatli qo'shildi! 🏢\nNomi: ${branch.name}\nKoordinatalar: ${branch.lat}, ${branch.lng}`,
    };
}

export function branchPickerView(branches: Branch[], year: number, month: number, callbackPrefix: string) {
    const keyboard = new InlineKeyboard();
    for (const branch of branches) {
        keyboard.text(branch.name, `${callbackPrefix}:${branch._id.toString()},${year},${month}`).row();
    }
    return {
        text: `Qaysi filial uchun ${month}/${year} hisobot kerak?`,
        keyboard,
    };
}
