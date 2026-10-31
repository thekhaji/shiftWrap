import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { monthRange, previousMonthSeoul, reportMonthSeoul } from '../libs/utils/date';

// shifts are stored as Seoul wall-clock time labeled as UTC, so "now" is shifted by +9h
const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;
const realNow = Date.now;
const setSeoulTime = (iso: string) => mock.method(Date, 'now', () => new Date(iso).getTime() - SEOUL_OFFSET_MS);

test('the previous month in the middle of a year', () => {
    setSeoulTime('2026-10-21T12:00:00Z');
    assert.deepEqual(previousMonthSeoul(), { year: 2026, month: 9 });
});

test('January looks back to December of the year before', () => {
    setSeoulTime('2026-01-05T12:00:00Z');
    assert.deepEqual(previousMonthSeoul(), { year: 2025, month: 12 });
});

test('the Seoul clock decides: 00:30 on the 1st in Seoul is already the new month', () => {
    // 2026-11-01 00:30 in Seoul is still 2026-10-31 15:30 in UTC
    setSeoulTime('2026-11-01T00:30:00Z');
    assert.deepEqual(previousMonthSeoul(), { year: 2026, month: 10 });
});

test('on the last day of the month the report is for that month', () => {
    setSeoulTime('2026-10-31T18:00:00Z');
    assert.deepEqual(reportMonthSeoul(), { year: 2026, month: 10 });
});

test('from the 25th on the report is for the month in progress', () => {
    setSeoulTime('2026-10-25T00:30:00Z');
    assert.deepEqual(reportMonthSeoul(), { year: 2026, month: 10 });
});

test('before the 25th the report is for the month that just ended', () => {
    setSeoulTime('2026-11-03T12:00:00Z');
    assert.deepEqual(reportMonthSeoul(), { year: 2026, month: 10 });
    setSeoulTime('2026-10-24T23:30:00Z');
    assert.deepEqual(reportMonthSeoul(), { year: 2026, month: 9 });
});

test('early January still reports December of the year before', () => {
    setSeoulTime('2027-01-02T12:00:00Z');
    assert.deepEqual(reportMonthSeoul(), { year: 2026, month: 12 });
});

test('month boundaries are half open', () => {
    const { start, end } = monthRange(2026, 12);
    assert.equal(start.toISOString(), '2026-12-01T00:00:00.000Z');
    assert.equal(end.toISOString(), '2027-01-01T00:00:00.000Z');
    mock.restoreAll();
    Date.now = realNow;
});
