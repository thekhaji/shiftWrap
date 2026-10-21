import mongoose, { Schema, Types } from 'mongoose';
import { ShiftPlan } from '../libs/utils/reportEdit';

export type SubmissionStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

// One employee's submitted report for one branch and month.
// No changes = APPROVED at once. Edited = PENDING until a manager approves; the edits are applied on approval.
const submissionSchema = new Schema(
    {
        memberId: { type: Schema.Types.ObjectId, ref: 'Member', required: true },
        branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
        year: { type: Number, required: true },
        month: { type: Number, required: true },
        status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'APPROVED' },
        revision: { type: Number, default: 0 },   // +1 per submit, so an old approval button can't approve a newer version
        submittedAt: { type: Date, required: true },
        minutesBefore: { type: Number, required: true },
        minutesAfter: { type: Number, required: true },
        changeLines: [{ type: String }],
        plan: { type: Schema.Types.Mixed },       // the edits waiting for approval
        decidedBy: { type: Schema.Types.ObjectId, ref: 'Member' },
        decidedAt: { type: Date },
    },
    { timestamps: true }
);

submissionSchema.index({ memberId: 1, branchId: 1, year: 1, month: 1 }, { unique: true });

export interface Submission {
    _id: Types.ObjectId;
    memberId: Types.ObjectId;
    branchId: Types.ObjectId;
    year: number;
    month: number;
    status: SubmissionStatus;
    revision: number;
    submittedAt: Date;
    minutesBefore: number;
    minutesAfter: number;
    changeLines: string[];
    plan?: ShiftPlan;
    decidedBy?: Types.ObjectId;
    decidedAt?: Date;
}

export default mongoose.model<Submission>('Submission', submissionSchema);
