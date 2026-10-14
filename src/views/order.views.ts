import { InlineKeyboard } from 'grammy';
import { Product } from '../libs/types/product';
import { Order } from '../libs/types/order';
import { OrderStatus } from '../libs/enums/order.enum';

export function orderPickerView(products: Product[], selectedIds: Set<string>) {
    const keyboard = new InlineKeyboard();
    for (const p of products) {
        const mark = selectedIds.has(p._id.toString()) ? '✅ ' : '';
        keyboard.text(`${mark}${p.name}`, `order_toggle:${p._id.toString()}`).row();
    }
    keyboard.text(`📤 Yuborish (${selectedIds.size})`, 'order_send').text('✖ Bekor qilish', 'order_cancel');
    return { text: "Nima yetishmayapti? Kerakli mahsulotlarni belgilang:", keyboard };
}

export function orderMessageView(order: Order, products: Product[], requesterName: string) {
    const byId = new Map(products.map(p => [p._id.toString(), p]));
    const lines = order.items.map((item, i) => {
        const p = byId.get(item.productId.toString());
        const hint = p?.orderNote ? ` — ${p.orderNote}` : '';
        return `${i + 1}. ${item.name}${hint}`;
    });
    const label = { DRAFT: '', ORDER: '🟡 Yangi buyurtma', ORDERED: '🔵 Buyurtma qilindi', ARRIVED: '🟢 Qabul qilindi' }[order.status];

    const keyboard = new InlineKeyboard();
    if (order.status === OrderStatus.ORDER) {
        for (const item of order.items) {
            const link = byId.get(item.productId.toString())?.orderLink;
            if (link) keyboard.url(`🔗 ${item.name}`, link).row();
        }
        keyboard.text('✅ Buyurtma qilindi', `order_ordered:${order._id.toString()}`);
    } else if (order.status === OrderStatus.ORDERED) {
        keyboard.text('📥 Qabul qilindi', `order_received:${order._id.toString()}`);
    }
    return { text: `${label}\nSo'radi: ${requesterName}\n\n${lines.join('\n')}`, keyboard };
}

export function storageMenuView() {
    const keyboard = new InlineKeyboard()
        .text("🛒 Buyurtma berish", "order_start").row()
        .text("➕ Mahsulot qo'shish", "product_add");
    return { text: "📦 Ombor", keyboard };
}

export function productStepView(step: 'name' | 'photo' | 'link' | 'note') {
    const texts = {
        name: "Mahsulot nomini yozing:",
        photo: "Mahsulot rasmini yuboring (ixtiyoriy):",
        link: "Buyurtma havolasini yuboring, masalan Coupang linki (ixtiyoriy):",
        note: "Qanday buyurtma qilinishini yozing, masalan «ishlab chiqaruvchidan, tel: ...» (ixtiyoriy):",
    };
    const keyboard = new InlineKeyboard();
    if (step !== 'name') keyboard.text("⏭ O'tkazib yuborish", "product_skip");
    keyboard.text("✖ Bekor qilish", "product_cancel");
    return { text: texts[step], keyboard };
}