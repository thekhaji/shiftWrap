import {ManagerRole, MemberStatus, MemberType} from '../enums/member.enum';
import {Types} from 'mongoose';
import {Lang} from '../i18n';

export interface Member {
    _id: Types.ObjectId;
    telegramId: number;
    name: string;
    username?: string;
    phone: string;
    language?: Lang;            // chosen at registration, changeable from the menu
    type: MemberType;
    managerRole?: ManagerRole;  // only for managers; unset = MAIN
    status: MemberStatus;
    branchId?: Types.ObjectId; //set by Boss/Admin
    hourlyRate?: number; //set by manager
    bankName?: string;  //set by manager
    bankAccount?: string; //set by manager
    createdAt: Date;
    updatedAt: Date;
}

export interface MemberInput {
    telegramId: number;
    name: string;
    username?: string;
    phone: string;
    language?: Lang;
    type?: MemberType;
    status?: MemberStatus;
}

// Fields a manager/boss/admin may set on an existing member — distinct from MemberInput
// (which shapes self-registration) so a member can never submit these about themselves.
export interface MemberManagerUpdate {
    type?: MemberType;
    managerRole?: ManagerRole;
    status?: MemberStatus;
    name?: string;
    phone?: string;
    branchId?: Types.ObjectId;
    hourlyRate?: number;
    bankName?: string;
    bankAccount?: string;
}

// The subset of MemberManagerUpdate collected via free-text prompts (the "✍️ type a new
// value" flow). branchId is deliberately excluded — it's set via a branch picker, not text.
export const EDITABLE_MEMBER_FIELDS = ["name", "phone", "bankName", "bankAccount", "hourlyRate"] as const;
export type EditableMemberField = typeof EDITABLE_MEMBER_FIELDS[number];