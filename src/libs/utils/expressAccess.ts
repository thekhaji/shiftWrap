import { Types } from 'mongoose';
import BranchModel from '../../schema/Branch.model';

// does this branch have access to at least one Express branch? Only then its managers see the Express button
export async function branchHasExpress(branchId?: Types.ObjectId): Promise<boolean> {
    if (!branchId) return false;
    return !!(await BranchModel.exists({ _id: branchId, expressSupplierIds: { $exists: true, $not: { $size: 0 } } }));
}
