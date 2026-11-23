import { Types } from 'mongoose';
import BranchModel from '../schema/Branch.model';
import MemberModel from '../schema/Member.model';
import ExpressProductModel from '../schema/ExpressProduct.model';
import { Branch } from '../libs/types/branch';
import { Member } from '../libs/types/member';
import { ExpressProduct } from '../libs/types/express';
import { MemberType } from '../libs/enums/member.enum';
import Errors, { HttpCode, Message } from '../libs/Errors';

type Id = Types.ObjectId;

// Guest restaurants: not our branches, they only order from the Express branches the admin allows,
// and only the products the admin ticked. The owner is the single manager of the guest "branch".
class GuestService {
    async getGuests(): Promise<Branch[]> {
        return BranchModel.find({ guest: true, guestRemoved: { $ne: true } }).sort({ name: 1 }).lean<Branch[]>();
    }

    async getGuest(id: string | Id): Promise<Branch | null> {
        if (typeof id === 'string' && !Types.ObjectId.isValid(id)) return null;
        return BranchModel.findOne({ _id: id, guest: true, guestRemoved: { $ne: true } }).lean<Branch>();
    }

    async getOwner(branchId: Id): Promise<Member | null> {
        return MemberModel.findOne({ branchId, type: MemberType.MANAGER }).lean<Member>();
    }

    // the Express products of these Express branches, for the tick list
    async getProductsOf(supplierIds: Id[]): Promise<ExpressProduct[]> {
        return ExpressProductModel.find({ expressBranchId: { $in: supplierIds } }).sort({ expressBranchId: 1, name: 1 }).lean<ExpressProduct[]>();
    }

    async createGuest(name: string, supplierIds: Id[], productIds: Id[]): Promise<Branch> {
        try {
            const branch = await BranchModel.create({ name, guest: true, expressSupplierIds: supplierIds, guestProductIds: productIds });
            return branch.toObject() as Branch;
        } catch (err: any) {
            if (err.code === 11000) throw new Errors(HttpCode.CONFLICT, Message.EXISTING_BRANCH);
            throw err;
        }
    }

    async rename(id: Id, name: string): Promise<Branch | null> {
        try {
            return await BranchModel.findOneAndUpdate({ _id: id, guest: true }, { $set: { name } }, { new: true }).lean<Branch>();
        } catch (err: any) {
            if (err.code === 11000) throw new Errors(HttpCode.CONFLICT, Message.EXISTING_BRANCH);
            throw err;
        }
    }

    // switch one Express branch on or off for a guest
    async toggleSupplier(id: Id, supplierId: Id): Promise<Branch | null> {
        const guest = await this.getGuest(id);
        if (!guest) return null;
        const has = !!guest.expressSupplierIds?.some(s => s.equals(supplierId));
        if (!has && !(await BranchModel.exists({ _id: supplierId, express: { $exists: true } }))) return guest;
        return BranchModel.findOneAndUpdate(
            { _id: id, guest: true },
            has ? { $pull: { expressSupplierIds: supplierId } } : { $addToSet: { expressSupplierIds: supplierId } },
            { new: true },
        ).lean<Branch>();
    }

    // tick or untick one product for a guest
    async toggleProduct(id: Id, productId: Id): Promise<Branch | null> {
        const guest = await this.getGuest(id);
        if (!guest) return null;
        const has = !!guest.guestProductIds?.some(p => p.equals(productId));
        return BranchModel.findOneAndUpdate(
            { _id: id, guest: true },
            has ? { $pull: { guestProductIds: productId } } : { $addToSet: { guestProductIds: productId } },
            { new: true },
        ).lean<Branch>();
    }

    async setProducts(id: Id, productIds: Id[]): Promise<Branch | null> {
        return BranchModel.findOneAndUpdate({ _id: id, guest: true }, { $set: { guestProductIds: productIds } }, { new: true }).lean<Branch>();
    }

    // Stops it from ordering: no Express access left. Its history, its owner's account and the orders
    // waiting for confirmation stay, so earlier report totals do not change.
    async remove(id: Id): Promise<Branch | null> {
        return BranchModel.findOneAndUpdate(
            { _id: id, guest: true },
            { $set: { guestRemoved: true, expressSupplierIds: [] } },
            { new: true },
        ).lean<Branch>();
    }

    // the owner is replaced: the old one can no longer order or confirm
    async removeOwner(branchId: Id): Promise<void> {
        await MemberModel.updateMany(
            { branchId, type: MemberType.MANAGER },
            { $set: { type: MemberType.USER, status: 'INACTIVE' }, $unset: { branchId: '', managerRole: '', panel: '' } },
        );
    }
}

export default GuestService;
