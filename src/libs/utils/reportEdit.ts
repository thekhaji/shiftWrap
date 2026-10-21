import ExcelJS from 'exceljs';
import { Types } from 'mongoose';

const MAX_SHIFT_MINUTES = 20 * 60;
const DAY_MS = 24 * 60 * 60 * 1000;

export type PlanErrorKey =
    | 'sub.err.noCheckout' | 'sub.err.noCheckin' | 'sub.err.badTime' | 'sub.err.tooLong'
    | 'sub.err.overlap' | 'sub.err.stale' | 'sub.err.noRate';

export interface PlanError { key: PlanErrorKey; row: number }

export interface ShiftPlan {
    updates: { id: string; checkIn: Date; checkOut?: Date }[];   // no checkOut = only the check-in changes
    creates: { checkIn: Date; checkOut: Date }[];
    deletes: string[];
    changeLines: string[];       // human readable, one per change
    changeCount: number;
    minutesBefore: number;
    minutesAfter: number;
}

export interface ExistingShift { _id: Types.ObjectId; checkIn: Date; checkOut?: Date | null }

interface ParsedRow {
    row: number;                 // spreadsheet row, for error messages
    day: number;
    shiftId?: string;
    from: number | null | 'bad'; // minutes after midnight, empty, or unreadable
    to: number | null | 'bad';
}

// "09:30" out of whatever the spreadsheet app saved: a day fraction, a date-time, text or a formula result
function parseTime(value: ExcelJS.CellValue): number | null | 'bad' {
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date) return value.getUTCHours() * 60 + value.getUTCMinutes();
    if (typeof value === 'number') {
        if (!Number.isFinite(value) || value < 0) return 'bad';
        return Math.round((value - Math.floor(value)) * 1440) % 1440;
    }
    if (typeof value === 'string') {
        const text = value.trim();
        if (!text) return null;
        const m = /^(\d{1,2})[:.](\d{2})\s*(am|pm)?$/i.exec(text);
        if (!m) return 'bad';
        let hours = Number(m[1]);
        const minutes = Number(m[2]);
        if (m[3]) {
            if (hours < 1 || hours > 12) return 'bad';
            hours = (hours % 12) + (m[3].toLowerCase() === 'pm' ? 12 : 0);
        }
        return hours < 24 && minutes < 60 ? hours * 60 + minutes : 'bad';
    }
    if (typeof value === 'object') {
        if ('result' in value) return parseTime((value as { result?: ExcelJS.CellValue }).result as ExcelJS.CellValue);
        if ('richText' in value) return parseTime(value.richText.map(r => r.text).join(''));
    }
    return 'bad';
}

function cellText(value: ExcelJS.CellValue): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object' && !(value instanceof Date)) {
        if ('richText' in value) return value.richText.map(r => r.text).join('');
        if ('result' in value) return String((value as { result?: unknown }).result ?? '');
    }
    return String(value);
}

export async function readEditedReport(
    buffer: Buffer,
    expectedMeta: string
): Promise<{ rows: ParsedRow[] } | { error: 'unreadable' | 'wrongFile' }> {
    const workbook = new ExcelJS.Workbook();
    try {
        await workbook.xlsx.load(buffer as any);
    } catch {
        return { error: 'unreadable' };
    }
    const sheet = workbook.worksheets[0];
    if (!sheet) return { error: 'unreadable' };
    if (cellText(sheet.getCell('F1').value) !== expectedMeta) return { error: 'wrongFile' };

    const rows: ParsedRow[] = [];
    sheet.eachRow((row, rowNumber) => {
        const day = row.getCell(1).value;
        const date = row.getCell(2).value;
        // day rows only; the title and summary rows don't have a number + a yyyy-mm-dd date
        if (typeof day !== 'number' || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
        rows.push({
            row: rowNumber,
            day,
            shiftId: cellText(row.getCell(6).value) || undefined,
            from: parseTime(row.getCell(3).value),
            to: parseTime(row.getCell(4).value),
        });
    });
    return { rows };
}

const pad = (n: number) => String(n).padStart(2, '0');
const clock = (d: Date) => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
const dateText = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const minuteOf = (d: Date) => Math.floor(d.getTime() / 60000);

// Compares the edited rows with what is in the database and says exactly what would change.
// No rows = "submit as it is". Shifts missing from the file are left alone; clear both times to delete one.
export function buildPlan(
    rows: ParsedRow[],
    shifts: ExistingShift[],
    year: number,
    month: number,
    hourlyRate?: number
): { plan: ShiftPlan } | { errors: PlanError[] } {
    const errors: PlanError[] = [];
    const byId = new Map(shifts.map(s => [s._id.toString(), s]));
    const handled = new Set<string>();
    const plan: ShiftPlan = { updates: [], creates: [], deletes: [], changeLines: [], changeCount: 0, minutesBefore: 0, minutesAfter: 0 };
    const result: { start: Date; end?: Date; row: number }[] = [];

    for (const s of shifts) {
        if (s.checkOut) plan.minutesBefore += Math.round((new Date(s.checkOut).getTime() - new Date(s.checkIn).getTime()) / 60000);
    }

    // start/end of an edited row; the end rolls over to the next day for night shifts
    const span = (day: number, from: number, to: number) => {
        const base = Date.UTC(year, month - 1, day);
        const start = new Date(base + from * 60000);
        const end = new Date(base + to * 60000 + (to <= from ? DAY_MS : 0));
        const minutes = Math.round((end.getTime() - start.getTime()) / 60000);
        return { start, end, valid: minutes > 0 && minutes <= MAX_SHIFT_MINUTES };
    };

    for (const r of rows) {
        if (r.from === 'bad' || r.to === 'bad') { errors.push({ key: 'sub.err.badTime', row: r.row }); continue; }
        const existing = r.shiftId ? byId.get(r.shiftId) : undefined;
        if (r.shiftId && (!existing || handled.has(r.shiftId))) { errors.push({ key: 'sub.err.stale', row: r.row }); continue; }

        if (existing) {
            handled.add(r.shiftId!);
            const oldIn = new Date(existing.checkIn);
            const oldOut = existing.checkOut ? new Date(existing.checkOut) : undefined;
            const oldText = `${clock(oldIn)}–${oldOut ? clock(oldOut) : '…'}`;
            const day = dateText(oldIn);

            if (r.from === null && r.to === null) {
                plan.deletes.push(r.shiftId!);
                plan.changeLines.push(`${day}  − ${oldText}`);
                continue;
            }
            if (r.from === null) { errors.push({ key: 'sub.err.noCheckin', row: r.row }); continue; }

            if (r.to === null) {
                if (oldOut) { errors.push({ key: 'sub.err.noCheckout', row: r.row }); continue; }
                // the shift never had a check-out: only its start can be corrected
                const start = new Date(Date.UTC(year, month - 1, r.day) + r.from * 60000);
                if (minuteOf(start) !== minuteOf(oldIn)) {
                    plan.updates.push({ id: r.shiftId!, checkIn: start });
                    plan.changeLines.push(`${day}  ${oldText} → ${clock(start)}–…`);
                }
                result.push({ start: minuteOf(start) !== minuteOf(oldIn) ? start : oldIn, row: r.row });
                continue;
            }

            const { start, end, valid } = span(r.day, r.from, r.to);
            if (!valid) { errors.push({ key: 'sub.err.tooLong', row: r.row }); continue; }
            const unchanged = minuteOf(start) === minuteOf(oldIn) && !!oldOut && minuteOf(end) === minuteOf(oldOut);
            if (!unchanged) {
                plan.updates.push({ id: r.shiftId!, checkIn: start, checkOut: end });
                plan.changeLines.push(`${day}  ${oldText} → ${clock(start)}–${clock(end)}`);
            }
            result.push(unchanged ? { start: oldIn, end: oldOut, row: r.row } : { start, end, row: r.row });
            continue;
        }

        // a row without an id: a day the employee filled in
        if (r.from === null && r.to === null) continue;
        if (r.from === null) { errors.push({ key: 'sub.err.noCheckin', row: r.row }); continue; }
        if (r.to === null) { errors.push({ key: 'sub.err.noCheckout', row: r.row }); continue; }
        const { start, end, valid } = span(r.day, r.from, r.to);
        if (!valid) { errors.push({ key: 'sub.err.tooLong', row: r.row }); continue; }
        if (!hourlyRate) { errors.push({ key: 'sub.err.noRate', row: r.row }); continue; }
        plan.creates.push({ checkIn: start, checkOut: end });
        plan.changeLines.push(`${dateText(start)}  + ${clock(start)}–${clock(end)}`);
        result.push({ start, end, row: r.row });
    }

    // shifts the file did not mention stay as they are
    for (const s of shifts) {
        if (!handled.has(s._id.toString())) {
            result.push({ start: new Date(s.checkIn), end: s.checkOut ? new Date(s.checkOut) : undefined, row: 0 });
        }
    }

    result.sort((a, b) => a.start.getTime() - b.start.getTime());
    for (let i = 1; i < result.length; i++) {
        const prev = result[i - 1];
        if (prev.end && result[i].start < prev.end) {
            errors.push({ key: 'sub.err.overlap', row: result[i].row || prev.row });
        }
    }
    if (errors.length > 0) return { errors };

    plan.minutesAfter = result.reduce((sum, r) => sum + (r.end ? Math.round((r.end.getTime() - r.start.getTime()) / 60000) : 0), 0);
    plan.changeCount = plan.updates.length + plan.creates.length + plan.deletes.length;
    return { plan };
}
