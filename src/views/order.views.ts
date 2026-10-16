import { Keyboard, InlineKeyboard } from 'grammy';
import { Product } from '../libs/types/product';
import { Order } from '../libs/types/order';
import { OrderStatus } from '../libs/enums/order.enum';
import { CATEGORY_LABELS,  ProductCategory} from '../libs/enums/product.enum';

export function storageMenuView() {
    const keyboard = new InlineKeyboard()
        .text("🛒 Buyurtma berish", "order_start").row()
        .text("➕ Mahsulot qo'shish", "product_add");
    return { text: "📦 Ombor", keyboard };
}

// one card per product: photo + name + note, with its own select button
export function productCardView(product: Product, selected: boolean) {
    const lines = [product.name];
    if (product.orderNote) lines.push(product.orderNote);
    const keyboard = new InlineKeyboard().text(
        selected ? '✅ Tanlandi (bekor qilish)' : '☐ Tanlash',
        `order_toggle:${product._id.toString()}`
    );
    return { text: lines.join('\n'), keyboard };
}

// step 1 of ordering: pick a category
export function orderCategoryView(counts: Map<ProductCategory, number>, uncategorized = 0) {
    const keyboard = new InlineKeyboard();
    for (const cat of Object.values(ProductCategory)) {
        keyboard.text(`${CATEGORY_LABELS[cat]} (${counts.get(cat) ?? 0})`, `order_cat:${cat}`).row();
    }
    // products saved before categories existed
    if (uncategorized) keyboard.text(`❓ Guruhsiz (${uncategorized})`, 'order_cat:NONE').row();
    keyboard.text('📤 Yuborish', 'order_send').text('✖ Bekor qilish', 'order_cancel');
    return { text: 'Mahsulotingiz tegishli bo\'lgan guruhni tanlang:', keyboard };
}

export function orderControlView() {
    const keyboard = new InlineKeyboard()
        .text('⬅️ Guruhlar', 'order_categories').row()
        .text('📤 Yuborish', 'order_send')
        .text('✖ Bekor qilish', 'order_cancel');
    return { text: 'Kerakli mahsulotlarni belgilab, "Yuborish" ni bosing:', keyboard };
}

// the message posted into the group topics
export function orderMessageView(order: Order, products: Product[], requesterName: string) {
    const byId = new Map(products.map(p => [p._id.toString(), p]));
    const lines = order.items.map((item, i) => {
        const p = byId.get(item.productId.toString());
        const hint = p?.orderNote ? ` — ${p.orderNote}` : '';
        return `${i + 1}. ${item.name}${hint}`;
    });

    const labels: Record<OrderStatus, string> = {
        [OrderStatus.DRAFT]: '',
        [OrderStatus.ORDER]: '🟡 Yangi buyurtma',
        [OrderStatus.ORDERED]: '🔵 Buyurtma qilindi',
        [OrderStatus.ARRIVED]: '🟢 Qabul qilindi',
    };

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

    return {
        text: `${labels[order.status]}\nSo'radi: ${requesterName}\n\n${lines.join('\n')}`,
        keyboard,
    };
}

export function productStepView(step: 'name' | 'category' | 'photo' | 'link' | 'note') {
    const texts = {
        name: "Mahsulot nomini yozing:",
        category: "Mahsulot guruhini tanlang:",
        photo: "Mahsulot rasmini yuboring (ixtiyoriy):",
        link: "Buyurtma havolasini yuboring, masalan Coupang linki (ixtiyoriy):",
        note: "Qanday buyurtma qilinishini yozing, masalan «ishlab chiqaruvchidan, tel: ...» (ixtiyoriy):",
    };
    const keyboard = new InlineKeyboard();
    if (step !== 'name') keyboard.text("⏭ O'tkazib yuborish", "product_skip");
    keyboard.text("✖ Bekor qilish", "product_cancel");
    return { text: texts[step], keyboard };
}

export function productCategoryView() {
    const keyboard = new InlineKeyboard();
    for (const cat of Object.values(ProductCategory)) {
        keyboard.text(CATEGORY_LABELS[cat], `product_cat:${cat}`).row();
    }
    keyboard.text("✖ Bekor qilish", "product_cancel");
    return { text: "Mahsulot qaysi guruhga tegishli?", keyboard };
}