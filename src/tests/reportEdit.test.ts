import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { Types } from 'mongoose';
import ReportService from '../models/Report.service';
import { buildPlan, readEditedReport } from '../libs/utils/reportEdit';

const memberId = new Types.ObjectId();
const branchId = new Types.ObjectId();
const member: any = { _id: memberId, name: 'Aziza', hourlyRate: 10000 };
const meta = `shiftwrap:${memberId}:${branchId}:2026:9`;

// seconds on purpose: the sheet only shows minutes, and an untouched row must still count as unchanged
const at = (day: number, h: number, m: number) => new Date(Date.UTC(2026, 8, day, h, m, 17, 123));
const shifts: any[] = [
    { _id: new Types.ObjectId(), checkIn: at(1, 9, 0), checkOut: at(1, 17, 30) },
    { _id: new Types.ObjectId(), checkIn: at(2, 9, 0), checkOut: at(2, 13, 0) },
    { _id: new Types.ObjectId(), checkIn: at(2, 14, 0), checkOut: at(2, 18, 0) },   // second shift on the same day
    { _id: new Types.ObjectId(), checkIn: at(3, 22, 0), checkOut: at(4, 2, 0) },    // night shift
    { _id: new Types.ObjectId(), checkIn: at(5, 9, 0) },                            // forgot to check out
];

async function download() {
    return new ReportService().generateSubmissionFile(member, shifts, branchId.toString(), 2026, 9);
}

async function edit(buffer: Buffer, change: (rowOfDay: (day: number, nth?: number) => ExcelJS.Row) => void) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    const sheet = workbook.worksheets[0];
    change((day, nth = 0) => {
        const found: ExcelJS.Row[] = [];
        sheet.eachRow(row => { if (row.getCell(1).value === day && typeof row.getCell(2).value === 'string') found.push(row); });
        return found[nth];
    });
    return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function plan(buffer: Buffer) {
    const parsed = await readEditedReport(buffer, meta);
    assert.ok('rows' in parsed);
    return buildPlan(parsed.rows, shifts, 2026, 9, 10000);
}

test('an untouched file changes nothing', async () => {
    const result = await plan(await download());
    assert.ok('plan' in result);
    assert.equal(result.plan.changeCount, 0);
    assert.equal(result.plan.minutesBefore, 1230);
    assert.equal(result.plan.minutesAfter, 1230);
});

test('edits, deletions, fixed check-outs and new days are detected', async () => {
    const edited = await edit(await download(), row => {
        row(1).getCell(4).value = 18 / 24;                                    // 17:30 -> 18:00
        row(2, 1).getCell(3).value = null; row(2, 1).getCell(4).value = null; // delete the second shift of day 2
        row(5).getCell(4).value = '17:00';                                    // fix the missing check-out, typed as text
        row(6).getCell(3).value = 8 / 24; row(6).getCell(4).value = 12.5 / 24; // add a day
    });
    const result = await plan(edited);
    assert.ok('plan' in result);
    assert.equal(result.plan.updates.length, 2);
    assert.equal(result.plan.creates.length, 1);
    assert.equal(result.plan.deletes.length, 1);
    assert.equal(result.plan.minutesAfter, 540 + 240 + 240 + 480 + 270);
});

test('a night shift keeps its next-day check-out', async () => {
    const edited = await edit(await download(), row => { row(3).getCell(3).value = 21 / 24; });
    const result = await plan(edited);
    assert.ok('plan' in result);
    assert.equal(result.plan.updates[0].checkOut?.toISOString(), at(4, 2, 0).toISOString().replace(':17.123', ':00.000'));
});

test('a start without an end is rejected', async () => {
    const edited = await edit(await download(), row => { row(7).getCell(3).value = 9 / 24; });
    const result = await plan(edited);
    assert.ok('errors' in result);
    assert.equal(result.errors[0].key, 'sub.err.noCheckout');
});

test('overlapping shifts are rejected', async () => {
    const edited = await edit(await download(), row => { row(2).getCell(4).value = 15 / 24; }); // 09:00-15:00 vs 14:00-18:00
    const result = await plan(edited);
    assert.ok('errors' in result);
    assert.equal(result.errors[0].key, 'sub.err.overlap');
});

test('a shift longer than 20 hours is rejected', async () => {
    const edited = await edit(await download(), row => { row(1).getCell(3).value = 8 / 24; row(1).getCell(4).value = 7.5 / 24; });
    const result = await plan(edited);
    assert.ok('errors' in result);
    assert.equal(result.errors[0].key, 'sub.err.tooLong');
});

test('text that is not a time is rejected', async () => {
    const edited = await edit(await download(), row => { row(1).getCell(4).value = 'later'; });
    const result = await plan(edited);
    assert.ok('errors' in result);
    assert.equal(result.errors[0].key, 'sub.err.badTime');
});

test('a file for another employee, branch or month is refused', async () => {
    const result = await readEditedReport(await download(), `shiftwrap:${new Types.ObjectId()}:${branchId}:2026:9`);
    assert.deepEqual(result, { error: 'wrongFile' });
});

test('something that is not a spreadsheet is unreadable', async () => {
    assert.deepEqual(await readEditedReport(Buffer.from('not a spreadsheet'), meta), { error: 'unreadable' });
});

test('new shifts need an hourly rate', async () => {
    const edited = await edit(await download(), row => { row(6).getCell(3).value = 8 / 24; row(6).getCell(4).value = 12 / 24; });
    const parsed = await readEditedReport(edited, meta);
    assert.ok('rows' in parsed);
    const result = buildPlan(parsed.rows, shifts, 2026, 9, undefined);
    assert.ok('errors' in result);
    assert.equal(result.errors[0].key, 'sub.err.noRate');
});
