import { Types } from 'mongoose';
import BranchModel from '../schema/Branch.model';
import ExpressProductModel from '../schema/ExpressProduct.model';
import ExpressOrderModel from '../schema/ExpressOrder.model';
import { Branch } from '../libs/types/branch';
import { ExpressOrder, ExpressOrderItem, ExpressProduct, QtyItem } from '../libs/types/express';
import { ExpressOrderStatus, ExpressType } from '../libs/enums/express.enum';
import { monthRange } from '../libs/utils/date';
import { nowInSeoul } from '../libs/utils/time';
import { MAX_QTY } from '../libs/utils/expressMath';

type Id = Types.ObjectId;
const asId = (id: string | Id) => (typeof id === 'string' ? new Types.ObjectId(id) : id);

class ExpressService {
    // ---------------- branches: which one is Taksim / Troy, who may order from whom ----------------

    async getExpressBranches(): Promise<Branch[]> {
        return BranchModel.find({ express: { $exists: true } }).lean<Branch[]>();
    }

    async getBranchByType(type: ExpressType): Promise<Branch | null> {
        return BranchModel.findOne({ express: type }).lean<Branch>();
    }

    // one branch per type: the answer says who already holds it
    async setType(branchId: Id, type: ExpressType): Promise<{ ok: true } | { ok: false; takenBy: Branch }> {
        const taken = await BranchModel.findOne({ express: type, _id: { $ne: branchId } }).lean<Branch>();
        if (taken) return { ok: false, takenBy: taken };
        try {
            // an Express branch sends products, it does not order them
            await BranchModel.updateOne({ _id: branchId }, { $set: { express: type }, $unset: { expressSupplierId: '' } });
        } catch (err: any) {
            if (err.code === 11000) {   // two admins at once: the unique index decides
                const holder = await BranchModel.findOne({ express: type }).lean<Branch>();
                if (holder) return { ok: false, takenBy: holder };
            }
            throw err;
        }
        return { ok: true };
    }

    // false = other branches still order from it, so it cannot stop being an Express branch
    async clearType(branchId: Id): Promise<boolean> {
        if (await BranchModel.exists({ expressSupplierId: branchId })) return false;
        await BranchModel.updateOne({ _id: branchId }, { $unset: { express: '', expressGroupId: '' } });
        return true;
    }

    // give a branch access to one Express branch (or none)
    async setSupplier(branchId: Id, supplierId: Id | null): Promise<boolean> {
        if (!supplierId) {
            await BranchModel.updateOne({ _id: branchId }, { $unset: { expressSupplierId: '' } });
            return true;
        }
        const supplier = await BranchModel.findOne({ _id: supplierId, express: { $exists: true } }).lean<Branch>();
        const branch = await BranchModel.findOne({ _id: branchId, express: { $exists: false } }).lean<Branch>();
        if (!supplier || !branch) return false;
        await BranchModel.updateOne({ _id: branchId }, { $set: { expressSupplierId: supplierId } });
        return true;
    }

    async setGroup(branchId: Id, chatId: number | null): Promise<boolean> {
        const res = chatId === null
            ? await BranchModel.updateOne({ _id: branchId, express: { $exists: true } }, { $unset: { expressGroupId: '' } })
            : await BranchModel.updateOne({ _id: branchId, express: { $exists: true } }, { $set: { expressGroupId: chatId } });
        return res.matchedCount > 0;
    }

    // branches that can still be made an Express branch: not Express, and not ordering from one
    async getCandidates(): Promise<Branch[]> {
        return BranchModel.find({ express: { $exists: false }, expressSupplierId: { $exists: false } }).sort({ name: 1 }).lean<Branch[]>();
    }

    async getBranchesWithoutExpress(): Promise<Branch[]> {
        return BranchModel.find({ express: { $exists: false } }).sort({ name: 1 }).lean<Branch[]>();
    }

    async getOrderingBranches(supplierId: Id): Promise<Branch[]> {
        return BranchModel.find({ expressSupplierId: supplierId }).sort({ name: 1 }).lean<Branch[]>();
    }

    // ---------------- products and prices ----------------

    async getProducts(expressBranchId: Id): Promise<ExpressProduct[]> {
        return ExpressProductModel.find({ expressBranchId }).sort({ name: 1 }).lean<ExpressProduct[]>();
    }

    async getProduct(id: string): Promise<ExpressProduct | null> {
        if (!Types.ObjectId.isValid(id)) return null;
        return ExpressProductModel.findById(id).lean<ExpressProduct>();
    }

    // null = a product with that name already exists in this Express branch
    async createProduct(expressBranchId: Id, name: string, price: number): Promise<ExpressProduct | null> {
        try {
            return (await ExpressProductModel.create({ expressBranchId, name, price })).toObject() as ExpressProduct;
        } catch (err: any) {
            if (err.code === 11000) return null;
            throw err;
        }
    }

    async updatePrice(id: string, price: number): Promise<ExpressProduct | null> {
        if (!Types.ObjectId.isValid(id)) return null;
        return ExpressProductModel.findByIdAndUpdate(id, { price }, { new: true }).lean<ExpressProduct>();
    }

    async deleteProduct(id: string): Promise<ExpressProduct | null> {
        if (!Types.ObjectId.isValid(id)) return null;
        return ExpressProductModel.findByIdAndDelete(id).lean<ExpressProduct>();
    }

    // ---------------- orders ----------------

    async createOrder(data: { orderBranchId: Id; supplierBranchId: Id; requestedBy: Id; neededDate: Date; items: ExpressOrderItem[] }): Promise<ExpressOrder> {
        return (await ExpressOrderModel.create(data)).toObject() as ExpressOrder;
    }

    async getOrder(id: string | Id): Promise<ExpressOrder | null> {
        if (typeof id === 'string' && !Types.ObjectId.isValid(id)) return null;
        return ExpressOrderModel.findById(id).lean<ExpressOrder>();
    }

    // new orders (and ones still waiting for someone to send them) of an Express branch
    async getPendingForSupplier(supplierBranchId: Id): Promise<ExpressOrder[]> {
        return ExpressOrderModel
            .find({ supplierBranchId, status: { $in: [ExpressOrderStatus.NEW, ExpressOrderStatus.ASSIGNED] } })
            .sort({ createdAt: 1 })
            .lean<ExpressOrder[]>();
    }

    // an Express manager tags who is responsible; they can tag someone else until it is sent
    async assign(orderId: Id, memberId: Id): Promise<ExpressOrder | null> {
        return ExpressOrderModel.findOneAndUpdate(
            { _id: orderId, status: { $in: [ExpressOrderStatus.NEW, ExpressOrderStatus.ASSIGNED] } },
            { $set: { status: ExpressOrderStatus.ASSIGNED, assignedTo: memberId, assignedAt: nowInSeoul() }, $unset: { draft: '' } },
            { new: true }
        ).lean<ExpressOrder>();
    }

    // start editing quantities: sending (from what was ordered) or confirming (from what was sent)
    async startDraft(orderId: Id, status: ExpressOrderStatus, quantities: QtyItem[]): Promise<ExpressOrder | null> {
        return ExpressOrderModel.findOneAndUpdate(
            { _id: orderId, status },
            { $set: { draft: quantities } },
            { new: true }
        ).lean<ExpressOrder>();
    }

    // +1 / -1 on one product of the draft, kept between 0 and MAX_QTY
    async adjustDraft(orderId: Id, productId: Id, delta: 1 | -1): Promise<ExpressOrder | null> {
        const order = await ExpressOrderModel.findById(orderId).lean<ExpressOrder>();
        const current = order?.draft?.find(d => d.productId.equals(productId));
        if (!order || !current) return order;
        const qty = Math.min(MAX_QTY, Math.max(0, current.qty + delta));
        return ExpressOrderModel.findOneAndUpdate(
            { _id: orderId },
            { $set: { 'draft.$[d].qty': qty } },
            { new: true, arrayFilters: [{ 'd.productId': productId }] }
        ).lean<ExpressOrder>();
    }

    // the tagged employee sent it: nothing but a still-assigned order can be marked sent, and only once
    async markSent(orderId: Id, memberId: Id, quantities: QtyItem[]): Promise<ExpressOrder | null> {
        return ExpressOrderModel.findOneAndUpdate(
            { _id: orderId, status: ExpressOrderStatus.ASSIGNED, assignedTo: memberId },
            { $set: { status: ExpressOrderStatus.SENT, sentItems: quantities, sentAt: nowInSeoul() }, $unset: { draft: '' } },
            { new: true }
        ).lean<ExpressOrder>();
    }

    // sent, but nobody asked the ordering branch yet, and the day it was needed on is over:
    // the question goes out the day after the ordered date
    async getDueForConfirmation(): Promise<ExpressOrder[]> {
        const today = nowInSeoul();
        const startOfToday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
        return ExpressOrderModel
            .find({ status: ExpressOrderStatus.SENT, askedAt: { $exists: false }, neededDate: { $lt: startOfToday } })
            .lean<ExpressOrder[]>();
    }

    // true only for the call that gets to ask, so the question goes out once
    async claimAsk(orderId: Id): Promise<boolean> {
        const res = await ExpressOrderModel.updateOne({ _id: orderId, askedAt: { $exists: false } }, { $set: { askedAt: nowInSeoul() } });
        return res.modifiedCount > 0;
    }

    // the ordering branch confirmed the quantities: the order is final and is charged to the branch
    async markReceived(orderId: Id, memberId: Id, quantities: QtyItem[]): Promise<ExpressOrder | null> {
        return ExpressOrderModel.findOneAndUpdate(
            { _id: orderId, status: ExpressOrderStatus.SENT },
            { $set: { status: ExpressOrderStatus.RECEIVED, receivedItems: quantities, receivedAt: nowInSeoul(), receivedBy: memberId }, $unset: { draft: '' } },
            { new: true }
        ).lean<ExpressOrder>();
    }

    // ---------------- receipts ----------------

    // the months (newest first) that have confirmed orders, optionally for one ordering branch
    async getReceivedMonths(supplierBranchId: Id, orderBranchId?: Id): Promise<{ year: number; month: number }[]> {
        const rows = await ExpressOrderModel.aggregate([
            { $match: { supplierBranchId, status: ExpressOrderStatus.RECEIVED, receivedAt: { $exists: true }, ...(orderBranchId ? { orderBranchId } : {}) } },
            { $group: { _id: { year: { $year: '$receivedAt' }, month: { $month: '$receivedAt' } } } },
            { $sort: { '_id.year': -1, '_id.month': -1 } },
        ]);
        return rows.map(r => ({ year: r._id.year, month: r._id.month }));
    }

    // confirmed orders of one Express branch in a month, optionally for one ordering branch
    async getReceivedInMonth(supplierBranchId: Id, year: number, month: number, orderBranchId?: Id): Promise<ExpressOrder[]> {
        const { start, end } = monthRange(year, month);
        return ExpressOrderModel
            .find({
                supplierBranchId,
                status: ExpressOrderStatus.RECEIVED,
                receivedAt: { $gte: start, $lt: end },
                ...(orderBranchId ? { orderBranchId } : {}),
            })
            .sort({ receivedAt: 1 })
            .lean<ExpressOrder[]>();
    }
}

export { asId };
export default ExpressService;
