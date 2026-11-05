import { ExpressOrder, ExpressOrderItem, QtyItem } from '../types/express';

export function money(value: number): string {
    return Math.round(value).toLocaleString('en-US');
}

export function orderTotal(items: { price: number; qty: number }[]): number {
    return items.reduce((sum, i) => sum + i.price * i.qty, 0);
}

// the order's items with other quantities (what was sent or received); a product not listed counts as 0
export function withQty(items: ExpressOrderItem[], quantities?: QtyItem[]): ExpressOrderItem[] {
    if (!quantities) return items;
    const byId = new Map(quantities.map(q => [q.productId.toString(), q.qty]));
    return items.map(i => ({ ...i, qty: byId.get(i.productId.toString()) ?? 0 }));
}

export function listText(items: ExpressOrderItem[], withPrice = true, keepZero = false): string {
    return items
        .filter(i => keepZero || i.qty > 0)
        .map((i, n) => `${n + 1}. ${i.name} × ${i.qty}${withPrice ? ` — ${money(i.price * i.qty)}` : ''}`)
        .join('\n');
}

export function sameQuantities(a: QtyItem[], b: QtyItem[]): boolean {
    const byId = new Map(a.map(q => [q.productId.toString(), q.qty]));
    return a.length === b.length && b.every(q => byId.get(q.productId.toString()) === q.qty);
}

export interface ReceiptLine { date: Date; product: string; qty: number; price: number; total: number }

// What a branch is charged for one order: the quantities it confirmed, at the price when it ordered.
export function receiptLines(order: ExpressOrder): ReceiptLine[] {
    if (!order.receivedItems || !order.receivedAt) return [];
    return withQty(order.items, order.receivedItems)
        .filter(i => i.qty > 0)
        .map(i => ({ date: order.receivedAt!, product: i.name, qty: i.qty, price: i.price, total: i.price * i.qty }));
}

export const MAX_QTY = 999;
