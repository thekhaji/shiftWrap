import MemberModel from '../schema/Member.model';
import { Member, MemberInput, MemberManagerUpdate } from '../libs/types/member';
import Errors, { HttpCode, Message } from '../libs/Errors';
import { Types } from 'mongoose';

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