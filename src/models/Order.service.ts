import { Types } from 'mongoose';
import OrderModel from '../schema/Order.model';
import { Order } from '../libs/types/order';
import { Product } from '../libs/types/product';
import { OrderStatus } from '../libs/enums/order.enum';
import Errors, { HttpCode, Message } from '../libs/Errors';

class OrderService {
    private readonly orderModel = OrderModel;

    async getOrCreateDraft(memberId: Types.ObjectId, branchId: Types.ObjectId): Promise<Order> {
        const filter = { requestedBy: memberId, branchId, status: OrderStatus.DRAFT };
        const existing = await this.orderModel.findOne(filter).lean<Order>();
        if (existing) return existing;
        try {
            const draft = await this.orderModel.create({ requestedBy: memberId, branchId });
            return draft.toObject() as Order;
        } catch (err: any) {
            // double tap: the partial index blocked a second draft, so read the first one
            if (err.code === 11000) return (await this.orderModel.findOne(filter).lean<Order>())!;
            throw err;
        }
    }

    // tap once = add, tap again = remove
    async toggleItem(draftId: Types.ObjectId, product: Product): Promise<Order> {
        const removed = await this.orderModel.findOneAndUpdate(
            { _id: draftId, status: OrderStatus.DRAFT, 'items.productId': product._id },
            { $pull: { items: { productId: product._id } } },
            { new: true }
        ).lean<Order>();
        if (removed) return removed;

        const added = await this.orderModel.findOneAndUpdate(
            { _id: draftId, status: OrderStatus.DRAFT },
            { $push: { items: { productId: product._id, name: product.name } } },
            { new: true }
        ).lean<Order>();
        if (!added) throw new Errors(HttpCode.NOT_FOUND, Message.NO_DATA_FOUND);
        return added;
    }

    // DRAFT -> one ORDER per product, so the boss can mark each product separately.
    // The basket is consumed; returns [] if it was empty or already submitted.
    async submitDraft(draftId: Types.ObjectId): Promise<Order[]> {
        const draft = await this.orderModel.findOneAndDelete({
            _id: draftId,
            status: OrderStatus.DRAFT,
            'items.0': { $exists: true },
        }).lean<Order>();
        if (!draft) return [];

        const docs = await this.orderModel.insertMany(
            draft.items.map(item => ({
                branchId: draft.branchId,
                requestedBy: draft.requestedBy,
                status: OrderStatus.ORDER,
                items: [item],
            }))
        );
        return docs.map(d => d.toObject() as Order);
    }

    // posting to the group failed: drop these orders and put their products back in the basket
    async restoreToDraft(failed: Order[]): Promise<void> {
        if (failed.length === 0) return;
        const { requestedBy, branchId } = failed[0];
        await this.orderModel.deleteMany({
            _id: { $in: failed.map(o => o._id) },
            status: OrderStatus.ORDER,
        });
        const draft = await this.getOrCreateDraft(requestedBy, branchId);
        await this.orderModel.updateOne(
            { _id: draft._id },
            { $push: { items: { $each: failed.flatMap(o => o.items) } } }
        );
    }

    // delete a draft without creating one first
    async cancelDraftFor(memberId: Types.ObjectId, branchId: Types.ObjectId): Promise<void> {
        await this.orderModel.deleteOne({
            requestedBy: memberId,
            branchId,
            status: OrderStatus.DRAFT,
        });
    }

    // atomic moves: a double tap returns null the second time
    async markOrdered(orderId: Types.ObjectId, memberId: Types.ObjectId): Promise<Order | null> {
        return this.orderModel.findOneAndUpdate(
            { _id: orderId, status: OrderStatus.ORDER },
            { status: OrderStatus.ORDERED, orderedBy: memberId },
            { new: true }
        ).lean<Order>();
    }

    async markArrived(orderId: Types.ObjectId, memberId: Types.ObjectId): Promise<Order | null> {
        return this.orderModel.findOneAndUpdate(
            { _id: orderId, status: OrderStatus.ORDERED },
            { status: OrderStatus.ARRIVED, receivedBy: memberId },
            { new: true }
        ).lean<Order>();
    }

    async setGroupMessageId(orderId: Types.ObjectId, messageId: number): Promise<void> {
        await this.orderModel.updateOne({ _id: orderId }, { groupMessageId: messageId });
    }

    async getById(orderId: string): Promise<Order | null> {
        if (!Types.ObjectId.isValid(orderId)) return null;
        return this.orderModel.findById(orderId).lean<Order>();
    }
}

export default OrderService;