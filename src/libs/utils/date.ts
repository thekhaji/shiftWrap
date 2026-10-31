import { nowInSeoul } from "./time";
import { reportCutoffDay } from "./config";

// The month that has just ended, on the Seoul clock.
export function previousMonthSeoul(): { year: number; month: number } {
    const now = nowInSeoul();
    const current = now.getUTCMonth(); // 0-based, so this is last month's 1-based number
    return current === 0 ? { year: now.getUTCFullYear() - 1, month: 12 } : { year: now.getUTCFullYear(), month: current };
}

// The month reports are submitted for, on the Seoul clock. Employees submit at the end of the
// month, so from the cutoff day on (default the 25th) it is the month in progress; before it,
// it is the month that just ended, for anyone who is late.
export function reportMonthSeoul(): { year: number; month: number } {
    const now = nowInSeoul();
    if (now.getUTCDate() >= reportCutoffDay()) return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
    return previousMonthSeoul();
}

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
