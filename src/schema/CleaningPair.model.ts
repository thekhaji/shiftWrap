import mongoose, { Schema } from 'mongoose';
import { CleaningPair } from '../libs/types/cleaning';
import { CleaningPlace } from '../libs/enums/cleaning.enum';

const cleaningPairSchema = new Schema<CleaningPair>(
    {
        branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
        memberId: { type: Schema.Types.ObjectId, ref: 'Member', required: true },
        memberName: { type: String, required: true },
        place: { type: String, enum: Object.values(CleaningPlace), required: true },
        beforeFileId: { type: String, required: true },
        afterFileId: { type: String, required: true },
        weekStart: { type: Date, required: true },
    },
    { timestamps: true }
);

cleaningPairSchema.index({ branchId: 1, weekStart: 1, place: 1 });

export default mongoose.model<CleaningPair>('CleaningPair', cleaningPairSchema);
