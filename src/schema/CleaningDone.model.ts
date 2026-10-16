import mongoose, { Schema } from 'mongoose';
import { CleaningDone } from '../libs/types/cleaning';

const cleaningDoneSchema = new Schema<CleaningDone>(
    {
        branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
        memberId: { type: Schema.Types.ObjectId, ref: 'Member', required: true },
        memberName: { type: String, required: true },
        weekStart: { type: Date, required: true },
    },
    { timestamps: true }
);

// one "done" flag per member per week
cleaningDoneSchema.index({ memberId: 1, weekStart: 1 }, { unique: true });

export default mongoose.model<CleaningDone>('CleaningDone', cleaningDoneSchema);
