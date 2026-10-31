import { Types } from 'mongoose';
import SubmissionModel, { Submission, SubmissionStatus } from '../schema/Submission.model';
import PayrollPeriodModel from '../schema/PayrollPeriod.model';
import { ShiftPlan } from '../libs/utils/reportEdit';

class PayrollService {
    // once the branch is ready for payroll, reports for that month can't change any more
    async isClosed(branchId: Types.ObjectId, year: number, month: number): Promise<boolean> {
        return !!(await PayrollPeriodModel.exists({ branchId, year, month }));
    }

    // a manager or boss lets the branch change reports again; it closes again when everyone is done
    async reopen(branchId: Types.ObjectId, year: number, month: number): Promise<void> {
        await PayrollPeriodModel.deleteOne({ branchId, year, month });
    }

    async hasSubmitted(memberId: Types.ObjectId, branchId: Types.ObjectId, year: number, month: number): Promise<boolean> {
        return !!(await SubmissionModel.exists({ memberId, branchId, year, month, status: { $ne: 'REJECTED' } }));
    }

    // submitting again replaces the earlier submission
    async saveSubmission(data: {
        memberId: Types.ObjectId; branchId: Types.ObjectId; year: number; month: number;
        status: 'PENDING' | 'APPROVED'; plan: ShiftPlan;
        decidedBy?: Types.ObjectId;   // a manager submitted it for the employee
    }): Promise<Submission> {
        const { memberId, branchId, year, month, status, plan, decidedBy } = data;
        const set: Record<string, unknown> = {
            status,
            submittedAt: new Date(),
            minutesBefore: plan.minutesBefore,
            minutesAfter: plan.minutesAfter,
            changeLines: plan.changeLines,
        };
        const unset: Record<string, ''> = { decidedBy: '', decidedAt: '' };
        if (decidedBy) {
            set.decidedBy = decidedBy;
            set.decidedAt = new Date();
            delete unset.decidedBy;
            delete unset.decidedAt;
        }
        if (status === 'PENDING') set.plan = plan; // only edits waiting for approval are kept
        else unset.plan = '';

        const doc = await SubmissionModel.findOneAndUpdate(
            { memberId, branchId, year, month },
            { $set: set, $unset: unset, $inc: { revision: 1 } },
            { upsert: true, new: true }
        );
        return doc!.toObject() as Submission;
    }

    async getSubmissionById(id: string): Promise<Submission | null> {
        if (!Types.ObjectId.isValid(id)) return null;
        return SubmissionModel.findById(id).lean<Submission>();
    }

    // Atomic: only the still-pending revision the manager looked at can be decided, and only once.
    async decide(id: Types.ObjectId, revision: number, status: 'APPROVED' | 'REJECTED', by: Types.ObjectId): Promise<Submission | null> {
        return SubmissionModel.findOneAndUpdate(
            { _id: id, revision, status: 'PENDING' },
            { $set: { status, decidedBy: by, decidedAt: new Date() } },
            { new: true }
        ).lean<Submission>();
    }

    // applying the edits failed: put it back so the manager can try again
    async markPending(id: Types.ObjectId): Promise<void> {
        await SubmissionModel.updateOne({ _id: id }, { $set: { status: 'PENDING' }, $unset: { decidedBy: '', decidedAt: '' } });
    }

    // edits waiting for approval; no branch = every branch
    async getPending(branchId?: Types.ObjectId): Promise<Submission[]> {
        return SubmissionModel.find({ status: 'PENDING', ...(branchId ? { branchId } : {}) })
            .sort({ submittedAt: 1 })
            .lean<Submission[]>();
    }

    async getStatuses(branchId: Types.ObjectId, year: number, month: number): Promise<Map<string, SubmissionStatus>> {
        const docs = await SubmissionModel.find({ branchId, year, month }).select('memberId status').lean<Submission[]>();
        return new Map(docs.map(d => [d.memberId.toString(), d.status ?? 'APPROVED']));
    }

    // true only for the call that makes the branch ready, so bosses are told exactly once
    async markReadyIfComplete(branchId: Types.ObjectId, year: number, month: number, requiredMemberIds: Types.ObjectId[]): Promise<boolean> {
        if (requiredMemberIds.length === 0) return false;
        const approved = new Set(
            (await SubmissionModel.distinct('memberId', { branchId, year, month, status: { $nin: ['PENDING', 'REJECTED'] } })).map(String)
        );
        if (!requiredMemberIds.every(id => approved.has(id.toString()))) return false;
        const before = await PayrollPeriodModel.findOneAndUpdate(
            { branchId, year, month },
            { $setOnInsert: { readyAt: new Date() } },
            { upsert: true, new: false }
        );
        return before === null;
    }
}

export default PayrollService;
