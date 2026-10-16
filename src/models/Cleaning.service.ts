import { Types } from 'mongoose';
import CleaningPairModel from '../schema/CleaningPair.model';
import CleaningDoneModel from '../schema/CleaningDone.model';
import { CleaningPair, CleaningPairInput, CleaningDone } from '../libs/types/cleaning';
import { CleaningPlace } from '../libs/enums/cleaning.enum';

class CleaningService {
    private readonly pairModel = CleaningPairModel;
    private readonly doneModel = CleaningDoneModel;

    async addPair(input: CleaningPairInput): Promise<CleaningPair> {
        const pair = await this.pairModel.create(input);
        return pair.toObject() as CleaningPair;
    }

    async getPairs(branchId: Types.ObjectId, weekStart: Date, place?: CleaningPlace): Promise<CleaningPair[]> {
        return this.pairModel
            .find({ branchId, weekStart, ...(place ? { place } : {}) })
            .sort({ createdAt: 1 })
            .lean<CleaningPair[]>();
    }

    async markDone(branchId: Types.ObjectId, memberId: Types.ObjectId, memberName: string, weekStart: Date): Promise<void> {
        await this.doneModel.updateOne(
            { memberId, weekStart },
            { $set: { branchId, memberName } },
            { upsert: true }
        );
    }

    async isDone(memberId: Types.ObjectId, weekStart: Date): Promise<boolean> {
        return !!(await this.doneModel.exists({ memberId, weekStart }));
    }

    async getDone(branchId: Types.ObjectId, weekStart: Date): Promise<CleaningDone[]> {
        return this.doneModel.find({ branchId, weekStart }).sort({ createdAt: 1 }).lean<CleaningDone[]>();
    }
}

export default CleaningService;
