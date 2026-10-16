import { nowInSeoul } from "./time";

// Returns the [start, end) instant boundaries for a given calendar month, expressed
// in the "Seoul wall-clock time labeled as UTC" convention used for stored attendance dates.
export function monthRange(year: number, month: number): { start: Date; end: Date } {
    return {
        start: new Date(Date.UTC(year, month - 1, 1)),
        end: new Date(Date.UTC(year, month, 1)),
    };
}

export function getMonthsBetween(startYear: number, startMonth: number, endYear: number, endMonth: number): { year: number; month: number }[] {
    const months: { year: number; month: number }[] = [];
    let y = startYear;
    let m = startMonth;

    while (y < endYear || (y === endYear && m < endMonth)) {
        months.push({ year: y, month: m });
        m++;
        if (m > 12) {
            m = 1;
            y++;
        }
    }

    return months;
}

// Monday 00:00 of the current Seoul week, in the same "Seoul labeled as UTC" convention.
export function currentWeekStartSeoul(): Date {
    const now = nowInSeoul();
    const sinceMonday = (now.getUTCDay() + 6) % 7;
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - sinceMonday));
}
