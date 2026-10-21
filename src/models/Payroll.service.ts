import { Types } from 'mongoose';
import SubmissionModel, { Submission } from '../schema/Submission.model';
import PayrollPeriodModel from '../schema/PayrollPeriod.model';

class PayrollService {
    // once the branch is ready for payroll, reports for that month can't change any more
    async isClosed(branchId: Types.ObjectId, year: number, month: number): Promise<boolean> {
        return !!(await PayrollPeriodModel.exists({ branchId, year, month }));
    }

    async hasSubmitted(memberId: Types.ObjectId, branchId: Types.ObjectId, year: number, month: number): Promise<boolean> {
        return !!(await SubmissionModel.exists({ memberId, branchId, year, month }));
    }

    // submitting again replaces the earlier submission
    async saveSubmission(data: Omit<Submission, 'submittedAt'>): Promise<void> {
        const { memberId, branchId, year, month, ...rest } = data;
        await SubmissionModel.updateOne(
            { memberId, branchId, year, month },
            { $set: { ...rest, submittedAt: new Date() } },
            { upsert: true }
        );
    }

    // true only for the call that makes the branch ready, so bosses are told exactly once
    async markReadyIfComplete(branchId: Types.ObjectId, year: number, month: number, requiredMemberIds: Types.ObjectId[]): Promise<boolean> {
        if (requiredMemberIds.length === 0) return false;
        const submitted = new Set((await SubmissionModel.distinct('memberId', { branchId, year, month })).map(String));
        if (!requiredMemberIds.every(id => submitted.has(id.toString()))) return false;
        const before = await PayrollPeriodModel.findOneAndUpdate(
            { branchId, year, month },
            { $setOnInsert: { readyAt: new Date() } },
            { upsert: true, new: false }
        );
        return before === null;
    }
}

export default PayrollService;
