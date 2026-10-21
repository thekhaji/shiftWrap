import AttendanceModel from '../schema/Attendance.model';
import MemberModel from '../schema/Member.model';
import { Attendance } from '../libs/types/attendance';
import Errors, { Message, HttpCode } from '../libs/Errors';
import { Types } from 'mongoose';
import { nowInSeoul } from '../libs/utils/time';
import { monthRange } from '../libs/utils/date';

const MAX_SHIFT_HOURS = 20;

class AttendanceService {
    private readonly attendanceModel = AttendanceModel;
    private readonly memberModel = MemberModel;

    async checkIn(telegramId: number, branchId: Types.ObjectId) {
        const member = await this.memberModel.findOne({ telegramId });
        if (!member) throw new Errors(HttpCode.NOT_FOUND, Message.NO_DATA_FOUND);
        if (!member.hourlyRate) throw new Errors(HttpCode.NOT_MODIFIED, Message.NO_RATE_SET);

        // a forgotten checkout must not block the unique open-shift index forever
        await this.getFreshOpenShift(member._id);

        try {
            const shift = await this.attendanceModel.create({
                memberId: member._id,
                branchId,
                checkIn: nowInSeoul(),
                hourlyRate: member.hourlyRate,
            });
            return shift.toObject();
        } catch (err: any) {
            if (err.code === 11000) throw new Errors(HttpCode.CONFLICT, Message.ALREADY_CHECKED_IN);
            throw err;
        }
    }

    async checkOut(telegramId: number, branchId: Types.ObjectId) {
        const member = await this.memberModel.findOne({ telegramId });
        if (!member) throw new Errors(HttpCode.NOT_FOUND, Message.NO_DATA_FOUND);

        const open = await this.getFreshOpenShift(member._id);
        if (!open) throw new Errors(HttpCode.NOT_FOUND, Message.NO_OPEN_SHIFT);

        const closed = await this.attendanceModel.findByIdAndUpdate(
            open._id,
            { checkOut: nowInSeoul() },
            { new: true }
        );
        return closed!.toObject();
    }

    async getOpenShift(memberId: Types.ObjectId) {
        return this.attendanceModel.findOne({ memberId, checkOut: { $exists: false } }).lean();
    }

    // Returns the member's open shift, or null. A shift open for 20h+ is treated as a
    // forgotten checkout: it is closed with checkOut = null (field present, so it leaves the
    // open-shift unique index, and reports still show it as "No check-out").
    private async getFreshOpenShift(memberId: Types.ObjectId) {
        const open = await this.getOpenShift(memberId);
        if (!open) return null;

        // checkIn is stored as Seoul wall-clock labeled as UTC, so compare against the same clock
        const elapsedHours = (nowInSeoul().getTime() - new Date(open.checkIn).getTime()) / (1000 * 60 * 60);
        if (elapsedHours < MAX_SHIFT_HOURS) return open;

        await this.attendanceModel.updateOne({ _id: open._id }, { $set: { checkOut: null } });
        return null;
    }

    async getMemberReport(telegramId: number, month: number, year: number): Promise<Attendance[]> {
        const member = await this.memberModel.findOne({ telegramId });
        if (!member) throw new Errors(HttpCode.NOT_FOUND, Message.NO_DATA_FOUND);

        const { start, end } = monthRange(year, month);

        return this.attendanceModel
            .find({ memberId: member._id, checkIn: { $gte: start, $lt: end } })
            .sort({ checkIn: 1 })
            .lean();
    }

    async getBranchIdsForMemberAndMonth(memberId: Types.ObjectId, year: number, month: number): Promise<Types.ObjectId[]> {
        const { start, end } = monthRange(year, month);

        return this.attendanceModel.distinct('branchId', {
            memberId,
            checkIn: { $gte: start, $lt: end },
        });
    }

    async getShiftsForMemberBranchAndMonth(memberId: Types.ObjectId, branchId: Types.ObjectId, year: number, month: number) {
        const { start, end } = monthRange(year, month);

        return this.attendanceModel
            .find({ memberId, branchId, checkIn: { $gte: start, $lt: end } })
            .sort({ checkIn: 1 })
            .lean();
    }

    async getMemberIdsForBranchAndMonth(branchId: Types.ObjectId, year: number, month: number): Promise<Types.ObjectId[]> {
        const { start, end } = monthRange(year, month);

        return this.attendanceModel.distinct('memberId', {
            branchId,
            checkIn: { $gte: start, $lt: end },
        });
    }

    // Money paid per month of `year` (index 0 = January): closed shifts only, at the rate
    // snapshotted on each shift. Months use the same Seoul-as-UTC convention as the reports.
    async getMonthlyPayroll(year: number, branchId?: Types.ObjectId): Promise<number[]> {
        const { start } = monthRange(year, 1);
        const { end } = monthRange(year, 12);
        const rows = await this.attendanceModel.aggregate([
            {
                $match: {
                    ...(branchId ? { branchId } : {}),
                    checkIn: { $gte: start, $lt: end },
                    checkOut: { $type: 'date' },
                },
            },
            {
                $group: {
                    _id: { $month: '$checkIn' },
                    total: { $sum: { $multiply: [{ $divide: [{ $subtract: ['$checkOut', '$checkIn'] }, 3600000] }, '$hourlyRate'] } },
                },
            },
        ]);
        const months = new Array<number>(12).fill(0);
        for (const r of rows) months[r._id - 1] = Math.round(r.total);
        return months;
    }

    // Earliest shift on record for a member — bounds how far back the "old reports" month picker goes.
    async getFirstCheckInDate(memberId: Types.ObjectId): Promise<Date | null> {
        const earliest = await this.attendanceModel
            .findOne({ memberId })
            .sort({ checkIn: 1 })
            .lean();
        return earliest ? earliest.checkIn : null;
    }
}

export default AttendanceService;