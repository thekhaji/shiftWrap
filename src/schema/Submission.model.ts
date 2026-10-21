import mongoose, { Schema, Types } from 'mongoose';

// One employee's submitted report for one branch and month. Kept as a record of what was changed.
const submissionSchema = new Schema(
    {
        memberId: { type: Schema.Types.ObjectId, ref: 'Member', required: true },
        branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
        year: { type: Number, required: true },
        month: { type: Number, required: true },
        submittedAt: { type: Date, required: true },
        minutesBefore: { type: Number, required: true },
        minutesAfter: { type: Number, required: true },
        changeLines: [{ type: String }],
    },
    { timestamps: true }
);

submissionSchema.index({ memberId: 1, branchId: 1, year: 1, month: 1 }, { unique: true });

export interface Submission {
    memberId: Types.ObjectId;
    branchId: Types.ObjectId;
    year: number;
    month: number;
    submittedAt: Date;
    minutesBefore: number;
    minutesAfter: number;
    changeLines: string[];
}

export default mongoose.model<Submission>('Submission', submissionSchema);
