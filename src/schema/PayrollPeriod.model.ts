import mongoose, { Schema } from 'mongoose';

// Exists once every employee of a branch has submitted a month: the payroll is ready and reports are locked.
const payrollPeriodSchema = new Schema(
    {
        branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
        year: { type: Number, required: true },
        month: { type: Number, required: true },
        readyAt: { type: Date, required: true },
    },
    { timestamps: true }
);

payrollPeriodSchema.index({ branchId: 1, year: 1, month: 1 }, { unique: true });

export default mongoose.model('PayrollPeriod', payrollPeriodSchema);
