import test from 'node:test';
import assert from 'node:assert/strict';
import { Types } from 'mongoose';
import { ManagerRole, MemberType } from '../libs/enums/member.enum';
import { hasManagerPermission, hasSalaryAccess, isAdmin, isAssistant, isBossOrAdmin, isManagerOf, isSalaryManagerOf } from '../libs/utils/permission';

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

const assistant = (): any => ({ type: MemberType.MANAGER, branchId: branch, managerRole: ManagerRole.ASSISTANT });
const mainManager = (): any => ({ type: MemberType.MANAGER, branchId: branch, managerRole: ManagerRole.MAIN });

test('the assistant still counts as a manager of the branch', () => {
    assert.equal(isAssistant(assistant()), true);
    assert.equal(hasManagerPermission(assistant()), true);
    assert.equal(isManagerOf(assistant(), branch.toString()), true);
});

test('only boss, admin and the main manager see pay', () => {
    assert.equal(hasSalaryAccess(make(MemberType.BOSS)), true);
    assert.equal(hasSalaryAccess(make(MemberType.ADMIN)), true);
    assert.equal(hasSalaryAccess(mainManager()), true);
    assert.equal(hasSalaryAccess(assistant()), false);
    assert.equal(hasSalaryAccess(make(MemberType.USER, branch)), false);
});

test('a manager without a role (from before assistants) is the main manager', () => {
    const legacy = make(MemberType.MANAGER, branch);
    assert.equal(isAssistant(legacy), false);
    assert.equal(hasSalaryAccess(legacy), true);
});

test('the assistant cannot act on pay for their own branch', () => {
    assert.equal(isSalaryManagerOf(mainManager(), branch.toString()), true);
    assert.equal(isSalaryManagerOf(assistant(), branch.toString()), false);
    assert.equal(isSalaryManagerOf(mainManager(), new Types.ObjectId().toString()), false);
});
