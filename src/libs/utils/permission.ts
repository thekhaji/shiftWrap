import {ManagerRole, MemberType} from '../enums/member.enum';
import {Member} from '../types/member';

export function hasManagerPermission(member: Member): boolean 
{
    return member.type === MemberType.MANAGER && !!member.branchId;
}

export function isManagerOf(member: Member, branchId: string): boolean {
    return member.type === MemberType.MANAGER && member.branchId?.toString() === branchId;
}

export function isBossOrAdmin(member: Member): boolean {
    return member.type === MemberType.BOSS || member.type === MemberType.ADMIN;
}

// only admins manage the product catalog and branch storage access
export function isAdmin(member: Member): boolean {
    return member.type === MemberType.ADMIN;
}

// the branch assistant runs the branch day to day but never sees pay
export function isAssistant(member: Member): boolean {
    return member.type === MemberType.MANAGER && member.managerRole === ManagerRole.ASSISTANT;
}

// salary, bank details, payroll, branch report and approving report edits:
// bosses, admins and the main manager of a branch (not the assistant)
export function hasSalaryAccess(member: Member): boolean {
    return isBossOrAdmin(member) || (hasManagerPermission(member) && !isAssistant(member));
}

export function isSalaryManagerOf(member: Member, branchId: string): boolean {
    return isManagerOf(member, branchId) && !isAssistant(member);
}
