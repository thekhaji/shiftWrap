import {MemberType} from '../enums/member.enum';
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
