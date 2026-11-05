import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { Types } from 'mongoose';
import { ExpressOrderStatus } from '../libs/enums/express.enum';
import { listText, orderTotal, receiptLines, sameQuantities, withQty } from '../libs/utils/expressMath';
import { buildExpressReceipt, linesTotal, branchLines } from '../libs/utils/expressReport';

const kimchi = new Types.ObjectId();
const rice = new Types.ObjectId();
const items = [
    { productId: kimchi, name: 'Kimchi', price: 12000, qty: 5 },
    { productId: rice, name: 'Rice', price: 3000, qty: 10 },
];

const order = (receivedItems?: { productId: Types.ObjectId; qty: number }[], day = '2026-10-12'): any => ({
    _id: new Types.ObjectId(), items, status: ExpressOrderStatus.RECEIVED,
    receivedItems, receivedAt: receivedItems ? new Date(`${day}T10:30:00Z`) : undefined,
});

test('an order total is quantity times the price at order time', () => {
    assert.equal(orderTotal(items), 5 * 12000 + 10 * 3000);
});

test('sent or received quantities replace what was asked for; a missing product counts as 0', () => {
    const received = withQty(items, [{ productId: kimchi, qty: 4 }]);
    assert.deepEqual(received.map(i => i.qty), [4, 0]);
    assert.equal(orderTotal(received), 4 * 12000);
});

test('the list shows only products with a quantity unless asked to keep zeros', () => {
    const half = withQty(items, [{ productId: kimchi, qty: 2 }]);
    assert.equal(listText(half, false), '1. Kimchi × 2');
    assert.equal(listText(half, false, true), '1. Kimchi × 2\n2. Rice × 0');
    assert.equal(listText(items), '1. Kimchi × 5 — 60,000\n2. Rice × 10 — 30,000');
});

test('quantities are compared by product, not by position', () => {
    const a = [{ productId: kimchi, qty: 5 }, { productId: rice, qty: 10 }];
    const b = [{ productId: rice, qty: 10 }, { productId: kimchi, qty: 5 }];
    assert.equal(sameQuantities(a, b), true);
    assert.equal(sameQuantities(a, [{ productId: kimchi, qty: 4 }, { productId: rice, qty: 10 }]), false);
    assert.equal(sameQuantities(a, [{ productId: kimchi, qty: 5 }]), false);
});

test('a branch is charged for what it confirmed, at the price it ordered at', () => {
    const lines = receiptLines(order([{ productId: kimchi, qty: 4 }, { productId: rice, qty: 10 }]));
    assert.deepEqual(lines.map(l => [l.product, l.qty, l.price, l.total]), [['Kimchi', 4, 12000, 48000], ['Rice', 10, 3000, 30000]]);
});

test('products confirmed as 0 are not on the receipt, and an unconfirmed order has no lines', () => {
    assert.deepEqual(receiptLines(order([{ productId: kimchi, qty: 0 }, { productId: rice, qty: 2 }])).map(l => l.product), ['Rice']);
    assert.deepEqual(receiptLines(order(undefined)), []);
});

test('the receipt workbook has a summary and one sheet per branch with correct totals', async () => {
    const { buffer, total } = await buildExpressReceipt({
        express: 'Taksim Express', year: 2026, month: 10,
        branches: [
            { name: 'Seul 1', orders: [order([{ productId: kimchi, qty: 4 }, { productId: rice, qty: 10 }]), order([{ productId: rice, qty: 3 }], '2026-10-20')] },
            { name: 'Seul 2', orders: [] },
        ],
    });
    assert.equal(total, 48000 + 30000 + 9000);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as any);
    assert.deepEqual(wb.worksheets.map(w => w.name), ['Summary', 'Seul 1', 'Seul 2']);
    const summary = wb.getWorksheet('Summary')!;
    assert.equal(summary.getRow(5).getCell(1).value, 'Seul 1');
    assert.equal(summary.getRow(5).getCell(2).value, 87000);
    assert.equal(summary.getRow(6).getCell(2).value, 0);
    const seul1 = wb.getWorksheet('Seul 1')!;
    assert.equal(seul1.getRow(6).getCell(2).value, 'Kimchi');
    assert.equal(seul1.getRow(6).getCell(5).value, 48000);
    assert.equal(linesTotal(branchLines([order([{ productId: kimchi, qty: 1 }])])), 12000);
});

test('a single branch gets one sheet and no summary; odd branch names make valid unique sheet names', async () => {
    const one = await buildExpressReceipt({ express: 'Troy Express', year: 2026, month: 10, branches: [{ name: 'Seul 1', orders: [order([{ productId: rice, qty: 1 }])] }] });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(one.buffer as any);
    assert.deepEqual(wb.worksheets.map(w => w.name), ['Seul 1']);

    const odd = await buildExpressReceipt({ express: 'Troy Express', year: 2026, month: 10, branches: [{ name: 'A/B:C?', orders: [] }, { name: 'A/B:C?', orders: [] }] });
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.load(odd.buffer as any);
    assert.equal(new Set(wb2.worksheets.map(w => w.name.toLowerCase())).size, 3);
    assert.ok(wb2.worksheets.every(w => !/[\\/?*[\]:]/.test(w.name) && w.name.length <= 31));
});
