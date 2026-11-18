import { Keyboard, InlineKeyboard } from 'grammy';
import { Product } from '../libs/types/product';
import { Order, OrderItem } from '../libs/types/order';
import { OrderStatus } from '../libs/enums/order.enum';
import { ProductCategory } from '../libs/enums/product.enum';
import { Lang, t } from '../libs/i18n';

export function storageMenuView(lang: Lang) {
    const keyboard = new InlineKeyboard().text(t(lang, 'storage.order'), "order_start");
    return { text: t(lang, 'storage.title'), keyboard };
}

// one card per product: photo + name + note, with its own select button
export function productCardView(lang: Lang, product: Product, selected: boolean, qty = 1) {
    const lines = [product.name];
    if (product.orderNote) lines.push(product.orderNote);
    const id = product._id.toString();
    const keyboard = new InlineKeyboard();
    // a chosen product shows how many: ➖ and ➕ change it, tapping the number lets you type it
    if (selected) keyboard.text('➖', `order_q:${id},m,c`).text(`${qty}`, `order_qe:${id},c`).text('➕', `order_q:${id},p,c`).row();
    keyboard.text(t(lang, selected ? 'order.selected' : 'order.select'), `order_toggle:${id}`);
    return { text: lines.join('\n'), keyboard };
}

// step 1 of ordering: pick a category
export function orderCategoryView(lang: Lang, counts: Map<ProductCategory, number>, uncategorized = 0) {
    const keyboard = new InlineKeyboard();
    for (const cat of Object.values(ProductCategory)) {
        keyboard.text(`${t(lang, `cat.${cat}`)} (${counts.get(cat) ?? 0})`, `order_cat:${cat}`).row();
    }
    // products saved before categories existed
    if (uncategorized) keyboard.text(`${t(lang, 'order.uncategorized')} (${uncategorized})`, 'order_cat:NONE').row();
    keyboard.text(t(lang, 'order.send'), 'order_send').text(t(lang, 'common.cancel'), 'order_cancel');
    return { text: t(lang, 'order.pickCategory'), keyboard };
}

// the last look before sending: every chosen product with a button to remove it, then Submit
export function orderReviewView(lang: Lang, items: OrderItem[]) {
    const keyboard = new InlineKeyboard();
    if (items.length === 0) {
        keyboard.text(t(lang, 'order.groups'), 'order_categories').row().text(t(lang, 'common.cancel'), 'order_cancel');
        return { text: t(lang, 'order.reviewEmpty'), keyboard };
    }
    for (const item of items) {
        const id = item.productId.toString();
        keyboard.text('➖', `order_q:${id},m,r`).text(`${item.name.length > 18 ? `${item.name.slice(0, 17)}…` : item.name} × ${item.qty ?? 1}`, `order_qe:${id},r`).text('➕', `order_q:${id},p,r`).text('❌', `order_rm:${id}`).row();
    }
    keyboard.text(t(lang, 'order.groups'), 'order_categories').text(t(lang, 'order.submit'), 'order_submit').row();
    keyboard.text(t(lang, 'common.cancel'), 'order_cancel');
    return { text: t(lang, 'order.reviewTitle', { n: items.length }), keyboard };
}

export function orderControlView(lang: Lang) {
    const keyboard = new InlineKeyboard()
        .text(t(lang, 'order.groups'), 'order_categories').row()
        .text(t(lang, 'order.send'), 'order_send')
        .text(t(lang, 'common.cancel'), 'order_cancel');
    return { text: t(lang, 'order.controlText'), keyboard };
}

// the message posted into the group topics
export function orderMessageView(order: Order, products: Product[], requesterName: string) {
    const byId = new Map(products.map(p => [p._id.toString(), p]));
    const lines = order.items.map((item, i) => {
        const p = byId.get(item.productId.toString());
        const hint = p?.orderNote ? ` — ${p.orderNote}` : '';
        const qty = item.qty ? ` × ${item.qty}` : '';   // orders from before quantities existed have none
        return `${i + 1}. ${item.name}${qty}${hint}`;
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
        keyboard.text('✅ Buyurtma qilindi', `order_ordered:${order._id.toString()}`).row();
        keyboard.text('❌ Bekor qilish', `order_cancel_new:${order._id.toString()}`);
    } else if (order.status === OrderStatus.ORDERED) {
        keyboard.text('📥 Qabul qilindi', `order_received:${order._id.toString()}`);
    }

    return {
        text: `${labels[order.status]}\nSo'radi: ${requesterName}\n\n${lines.join('\n')}`,
        keyboard,
    };
}

export function productStepView(lang: Lang, step: 'name' | 'category' | 'photo' | 'link' | 'note') {
    const keyboard = new InlineKeyboard();
    if (step !== 'name') keyboard.text(t(lang, 'product.skip'), "product_skip");
    keyboard.text(t(lang, 'common.cancel'), "product_cancel");
    return { text: t(lang, `product.step.${step}`), keyboard };
}

export function productCategoryView(lang: Lang) {
    const keyboard = new InlineKeyboard();
    for (const cat of Object.values(ProductCategory)) {
        keyboard.text(t(lang, `cat.${cat}`), `product_cat:${cat}`).row();
    }
    keyboard.text(t(lang, 'common.cancel'), "product_cancel");
    return { text: t(lang, 'product.categoryQ'), keyboard };
}
