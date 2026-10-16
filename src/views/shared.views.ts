import { Keyboard } from "grammy";
import { Member } from "../libs/types/member";
import { hasManagerPermission } from "../libs/utils/permission";

function mainMenuKeyboard(member?: Member) {
    const employeeKeyboard = new Keyboard()
        .text("✅ Check In")
        .text("🚪 Check Out")
        .row()
        .text("📊 Hisobot")
        .row()
        .text("🧹 Tozalash")
        .row()
        .text("🗂 Eski hisobotlar")
        .resized()
        .persistent();

    if (member?.type === "BOSS" || member?.type === "ADMIN") {
        const keyboard = new Keyboard()
            .text("🏢 Filial qo'shish")
            .row()
            .text("Filialga boshqaruchi saylash")
            .row()
            .text("📊 Filial hisoboti")
            .resized()
            .persistent();
        return keyboard;
    }
    else if (member && (hasManagerPermission(member))) {
        employeeKeyboard.row().text("📦 Ombor");
        employeeKeyboard.row().text("🧼 Tozalash hisoboti");
        employeeKeyboard.row().text("📊 Filial hisoboti");
        employeeKeyboard.row().text("👥 Xodimlar ma'lumotlarini sozlash");

    }

    return employeeKeyboard;
}

export function mainMenuView(member: Member) {
    return {
        text: `Xush kelibsiz, ${member.name}! 👋\nKerakli amalni tanlang:`,
        keyboard: mainMenuKeyboard(member),
    };
}

export function backToMenuView(member?: Member) {
    return {
        text: "Bosh menyu 🏠",
        keyboard: mainMenuKeyboard(member),
    };
}

export function menuUpdatedView(member: Member) {
    return {
        text: "Botda yangilanish bo'ldi! ✨\nMenyu yangilandi, quyidagi tugmalardan foydalanishingiz mumkin:",
        keyboard: mainMenuKeyboard(member),
    };
}

export function errorView() {
    return {
        text: "Xatolik yuz berdi. Iltimos, qayta urinib ko'ring 🙏",
    };
}
