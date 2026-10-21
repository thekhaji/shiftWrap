import test from 'node:test';
import assert from 'node:assert/strict';
import { adminTelegramIds } from '../libs/utils/config';

test('ADMIN_TELEGRAM_IDS is parsed and cleaned', () => {
    process.env.ADMIN_TELEGRAM_IDS = ' 123456789, 987654321 ,abc,,-5,0';
    assert.deepEqual(adminTelegramIds(), [123456789, 987654321]);
});

test('no admins configured', () => {
    delete process.env.ADMIN_TELEGRAM_IDS;
    assert.deepEqual(adminTelegramIds(), []);
});
