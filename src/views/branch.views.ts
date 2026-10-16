import { Keyboard, InlineKeyboard } from "grammy";
import { Branch } from "../libs/types/branch";
import { Member } from "../libs/types/member";

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


// Boss/Admin: step 1 of appointing a branch manager
export function managerBranchPickerView(branches: Branch[]) {
    const keyboard = new InlineKeyboard();
    for (const branch of branches) {
        keyboard.text(branch.name, `mgr_branch:${branch._id.toString()}`).row();
    }
    return { text: "Qaysi filial uchun boshqaruvchi tayinlamoqchisiz?", keyboard };
}

// step 2: pick the employee (boss/admin accounts are never candidates)
export function managerCandidatePickerView(branch: Branch, candidates: Member[]) {
    const keyboard = new InlineKeyboard();
    for (const user of candidates) {
        keyboard.text(user.name, `mgr_user:${branch._id.toString()},${user.telegramId}`).row();
    }
    return { text: `${branch.name} filiali uchun boshqaruvchini tanlang:`, keyboard };
}
