import mongoose, { Schema } from 'mongoose';
import { ExpressOrder } from '../libs/types/express';
import { ExpressOrderStatus } from '../libs/enums/express.enum';

const qtyItem = { _id: false, productId: { type: Schema.Types.ObjectId, required: true }, qty: { type: Number, required: true, min: 0 } };

const expressOrderSchema = new Schema(
    {
        orderBranchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
        supplierBranchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
        requestedBy: { type: Schema.Types.ObjectId, ref: 'Member', required: true },
        neededDate: { type: Date, required: true },
        items: [{
            _id: false,
            productId: { type: Schema.Types.ObjectId, required: true },
            name: { type: String, required: true },
            price: { type: Number, required: true },
            qty: { type: Number, required: true, min: 1 },
        }],
        status: { type: String, enum: ExpressOrderStatus, default: ExpressOrderStatus.NEW },
        assignedTo: { type: Schema.Types.ObjectId, ref: 'Member' },
        assignedAt: { type: Date },
        draft: [qtyItem],
        sentItems: [qtyItem],
        sentAt: { type: Date },
        askedAt: { type: Date },
        receivedItems: [qtyItem],
        receivedAt: { type: Date },
        receivedBy: { type: Schema.Types.ObjectId, ref: 'Member' },
    },
    { timestamps: true }
);

expressOrderSchema.index({ supplierBranchId: 1, status: 1 });
expressOrderSchema.index({ status: 1, askedAt: 1, sentAt: 1 });

export default mongoose.model<ExpressOrder>('ExpressOrder', expressOrderSchema);
