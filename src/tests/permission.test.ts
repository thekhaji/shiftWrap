import test from 'node:test';
import assert from 'node:assert/strict';
import { Types } from 'mongoose';
import { MemberType } from '../libs/enums/member.enum';
import { hasManagerPermission, isAdmin, isBossOrAdmin, isManagerOf } from '../libs/utils/permission';

const branch = new Types.ObjectId();
const make = (type: MemberType, branchId?: Types.ObjectId): any => ({ type, branchId });

test('only an admin is an admin', () => {
    assert.equal(isAdmin(make(MemberType.ADMIN)), true);
    for (const type of [MemberType.BOSS, MemberType.MANAGER, MemberType.USER]) assert.equal(isAdmin(make(type)), false);
});

test('boss and admin count as bosses; managers and employees do not', () => {
    assert.equal(isBossOrAdmin(make(MemberType.BOSS)), true);
    assert.equal(isBossOrAdmin(make(MemberType.ADMIN)), true);
    assert.equal(isBossOrAdmin(make(MemberType.MANAGER, branch)), false);
    assert.equal(isBossOrAdmin(make(MemberType.USER)), false);
});

test('a manager needs a branch', () => {
    assert.equal(hasManagerPermission(make(MemberType.MANAGER, branch)), true);
    assert.equal(hasManagerPermission(make(MemberType.MANAGER)), false);
    assert.equal(hasManagerPermission(make(MemberType.USER, branch)), false);
});

test('a manager manages only their own branch', () => {
    assert.equal(isManagerOf(make(MemberType.MANAGER, branch), branch.toString()), true);
    assert.equal(isManagerOf(make(MemberType.MANAGER, branch), new Types.ObjectId().toString()), false);
    assert.equal(isManagerOf(make(MemberType.USER, branch), branch.toString()), false);
});
