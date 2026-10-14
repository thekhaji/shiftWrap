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

    // DRAFT -> ORDER, only if there is at least one item
    async submitDraft(draftId: Types.ObjectId): Promise<Order | null> {
        return this.orderModel.findOneAndUpdate(
            { _id: draftId, status: OrderStatus.DRAFT, 'items.0': { $exists: true } },
            { status: OrderStatus.ORDER },
            { new: true }
        ).lean<Order>();
    }

    async cancelDraft(draftId: Types.ObjectId): Promise<void> {
        await this.orderModel.deleteOne({ _id: draftId, status: OrderStatus.DRAFT });
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
        return this.orderModel.findById(orderId).lean<Order>();
    }
}

export default OrderService;