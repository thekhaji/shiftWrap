import MemberModel from '../schema/Member.model';
import { Member, MemberInput, MemberManagerUpdate } from '../libs/types/member';
import Errors, { HttpCode, Message } from '../libs/Errors';
import { Types } from 'mongoose';
import { Lang } from '../libs/i18n';
import { MemberStatus, MemberType } from '../libs/enums/member.enum';

export const MAX_MANAGERS_PER_BRANCH = 2;

class MemberService {
    private readonly memberModel;

    constructor() {
        this.memberModel = MemberModel;
    }

    async getMemberById(memberId: Types.ObjectId): Promise<Member | null> {
        return this.memberModel.findById(memberId).lean<Member>();
    }

    async getMemberByTelegramId(telegramId: number): Promise<Member | null> {
        const member = await this.memberModel.findOne({ telegramId });
        return member ? (member.toObject() as Member) : null;
    }

    async createMember(memberInput: MemberInput): Promise<Member> {
        const exist = await this.getMemberByTelegramId(memberInput.telegramId);
        if (exist) {
            throw new Errors(HttpCode.BAD_REQUEST, Message.EXISTING_USER);
        }

        try {
            const newMember = await this.memberModel.create(memberInput);
            return newMember.toObject() as Member;
        } catch (error: any) {
            console.error("Error creating member:", error);
            if (error.code === 11000) {
                throw new Errors(HttpCode.BAD_REQUEST, Message.EXISTING_USER);
            }
            throw new Errors(HttpCode.BAD_REQUEST, Message.CREATE_FAILED);
        }
    }

    async getMembersByIds(memberIds: Types.ObjectId[]): Promise<Member[]> {
        const members = await this.memberModel.find({ _id: { $in: memberIds } });
        return members.map(member => member.toObject() as Member);
    }

    async getAllMembers(): Promise<Member[]> {
        const members = await this.memberModel.find();
        return members.map(member => member.toObject() as Member);
    }

    async setLanguage(telegramId: number, language: Lang): Promise<Member> {
        const member = await this.memberModel.findOneAndUpdate({ telegramId }, { language }, { new: true });
        if (!member) {
            throw new Errors(HttpCode.NOT_FOUND, Message.NO_DATA_FOUND);
        }
        return member.toObject() as Member;
    }

    async getManagersByBranch(branchId: Types.ObjectId): Promise<Member[]> {
        return this.memberModel.find({ type: MemberType.MANAGER, branchId }).sort({ name: 1 }).lean<Member[]>();
    }

    // a branch holds at most MAX_MANAGERS_PER_BRANCH managers
    async assignManager(telegramId: number, branchId: Types.ObjectId): Promise<Member> {
        const managers = await this.getManagersByBranch(branchId);
        if (!managers.some(m => m.telegramId === telegramId) && managers.length >= MAX_MANAGERS_PER_BRANCH) {
            throw new Errors(HttpCode.BAD_REQUEST, Message.MANAGER_LIMIT);
        }
        return this.updateMember(telegramId, { type: MemberType.MANAGER, branchId, status: MemberStatus.ACTIVE });
    }

    // employee changed their mind or was rejected: they pick a branch again
    async clearBranch(telegramId: number): Promise<void> {
        await this.memberModel.updateOne({ telegramId }, { $unset: { branchId: '' } });
    }

    async getBossesAndAdmins(): Promise<Member[]> {
        return this.memberModel.find({ type: { $in: [MemberType.BOSS, MemberType.ADMIN] } }).lean<Member[]>();
    }

    // Atomic answer to a join request: only a still-pending employee who asked for THIS branch.
    // Confirm -> active; reject -> branch cleared so they pick again. null = already handled.
    async resolveJoinRequest(telegramId: number, branchId: Types.ObjectId, approve: boolean): Promise<Member | null> {
        return this.memberModel.findOneAndUpdate(
            { telegramId, type: MemberType.USER, status: MemberStatus.PENDING, branchId },
            approve ? { status: MemberStatus.ACTIVE } : { $unset: { branchId: '' } },
            { new: true }
        ).lean<Member>();
    }

    // an invited boss: no branch, no confirmation needed
    async promoteToBoss(telegramId: number): Promise<Member> {
        const member = await this.memberModel.findOneAndUpdate(
            { telegramId },
            { type: MemberType.BOSS, status: MemberStatus.ACTIVE, $unset: { branchId: '' } },
            { new: true }
        );
        if (!member) throw new Errors(HttpCode.NOT_FOUND, Message.NO_DATA_FOUND);
        return member.toObject() as Member;
    }

    // back to a plain employee with no branch
    async removeManager(telegramId: number): Promise<Member> {
        const member = await this.memberModel.findOneAndUpdate(
            { telegramId },
            { type: MemberType.USER, $unset: { branchId: '' } },
            { new: true }
        );
        if (!member) throw new Errors(HttpCode.NOT_FOUND, Message.NO_DATA_FOUND);
        return member.toObject() as Member;
    }

    async updateMember(telegramId: number, updateData: MemberManagerUpdate): Promise<Member> {
        const member = await this.memberModel.findOneAndUpdate(
            { telegramId },
            updateData,
            { new: true }
        );
        if (!member) {
            throw new Errors(HttpCode.NOT_FOUND, Message.NO_DATA_FOUND);
        }
        return member.toObject() as Member;
    }
}

export default MemberService;