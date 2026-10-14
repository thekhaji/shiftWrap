import mongoose, { Schema } from 'mongoose';
import { Order } from '../libs/types/order';
import { OrderStatus } from '../libs/enums/order.enum';

const orderSchema = new Schema<Order>(
    {
        branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
        requestedBy: { type: Schema.Types.ObjectId, ref: 'Member', required: true },
        status: { type: String, enum: Object.values(OrderStatus), default: OrderStatus.DRAFT },
        items: [
            {
                _id: false,
                productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
                name: { type: String, required: true },
            },
        ],
        orderedBy: { type: Schema.Types.ObjectId, ref: 'Member' },
        receivedBy: { type: Schema.Types.ObjectId, ref: 'Member' },
        groupMessageId: { type: Number },
    },
    { timestamps: true }
);

// At most one DRAFT basket per manager per branch; sent orders are unlimited.
orderSchema.index(
    { requestedBy: 1, branchId: 1 },
    { unique: true, partialFilterExpression: { status: OrderStatus.DRAFT } }
);

export default mongoose.model<Order>('Order', orderSchema);