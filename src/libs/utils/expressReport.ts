import ExcelJS from 'exceljs';
import { ExpressOrder } from '../types/express';
import { orderTotal, receiptLines, ReceiptLine } from './expressMath';

export interface ReceiptBranch { name: string; orders: ExpressOrder[] }

const isoDay = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

// Excel sheet names: at most 31 characters, none of \ / ? * [ ] :, and unique in the workbook
function sheetName(raw: string, used: Set<string>): string {
    const base = raw.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 28) || 'Branch';
    let name = base;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base} ${i}`;
    used.add(name.toLowerCase());
    return name;
}

export function branchLines(orders: ExpressOrder[]): ReceiptLine[] {
    return orders.flatMap(receiptLines);
}

export const linesTotal = (lines: ReceiptLine[]) => orderTotal(lines.map(l => ({ price: l.price, qty: l.qty })));

// One receipt per ordering branch: what it got from the Express branch in the month, at the price
// it ordered at. With several branches the first sheet is a summary.
export async function buildExpressReceipt(opts: { express: string; year: number; month: number; branches: ReceiptBranch[] }): Promise<{ buffer: Buffer; total: number }> {
    const workbook = new ExcelJS.Workbook();
    const used = new Set<string>();
    const monthText = `${opts.year}-${String(opts.month).padStart(2, '0')}`;
    const per = opts.branches.map(b => ({ name: b.name, lines: branchLines(b.orders) }));
    const grand = per.reduce((sum, b) => sum + linesTotal(b.lines), 0);
    const bold = { bold: true };
    const center = { horizontal: 'center' as const };

    if (per.length > 1) {
        const sheet = workbook.addWorksheet(sheetName('Summary', used));
        sheet.addRow(['Express:', opts.express]).font = bold;
        sheet.addRow(['Month:', monthText]).font = bold;
        sheet.addRow([]);
        const header = sheet.addRow(['Branch', 'Total']);
        header.font = bold;
        for (const b of per) sheet.addRow([b.name, linesTotal(b.lines)]).getCell(2).numFmt = '#,##0';
        const totalRow = sheet.addRow(['Total', grand]);
        totalRow.font = bold;
        totalRow.getCell(2).numFmt = '#,##0';
        sheet.columns = [{ width: 28 }, { width: 18 }];
    }

    for (const b of per) {
        const sheet = workbook.addWorksheet(sheetName(b.name, used));
        sheet.addRow(['Express:', opts.express]).font = bold;
        sheet.addRow(['Branch:', b.name]).font = bold;
        sheet.addRow(['Month:', monthText]).font = bold;
        sheet.addRow([]);
        const header = sheet.addRow(['Date received', 'Product', 'Quantity', 'Unit price', 'Total']);
        header.font = bold;
        header.eachCell(c => { c.alignment = center; });
        for (const l of b.lines) {
            const row = sheet.addRow([isoDay(l.date), l.product, l.qty, l.price, l.total]);
            row.getCell(4).numFmt = '#,##0';
            row.getCell(5).numFmt = '#,##0';
            row.getCell(1).alignment = center;
            row.getCell(3).alignment = center;
        }
        sheet.addRow([]);
        const totalRow = sheet.addRow(['', '', '', 'Total', linesTotal(b.lines)]);
        totalRow.font = bold;
        totalRow.getCell(5).numFmt = '#,##0';
        sheet.columns = [{ width: 16 }, { width: 30 }, { width: 10 }, { width: 14 }, { width: 16 }];
    }

    return { buffer: Buffer.from(await workbook.xlsx.writeBuffer()), total: grand };
}
