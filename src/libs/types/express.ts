import { Types } from 'mongoose';
import { ExpressOrderStatus } from '../enums/express.enum';

export interface ExpressProduct {
    _id: Types.ObjectId;
    expressBranchId: Types.ObjectId;
    name: string;
    price: number;          // won, per unit
    createdAt: Date;
}

export interface ExpressOrderItem {
    productId: Types.ObjectId;
    name: string;           // snapshot at order time
    price: number;          // snapshot at order time: later price changes never touch an old order
    qty: number;            // what the branch asked for
}

export interface QtyItem {
    productId: Types.ObjectId;
    qty: number;
}

export interface ExpressOrder {
    _id: Types.ObjectId;
    orderBranchId: Types.ObjectId;      // the branch that orders
    supplierBranchId: Types.ObjectId;   // the Express branch that sends the products
    requestedBy: Types.ObjectId;
    neededDate: Date;                   // Seoul wall-clock day, stored like shifts are
    items: ExpressOrderItem[];
    status: ExpressOrderStatus;
    assignedTo?: Types.ObjectId;        // the Express employee responsible for sending
    assignedAt?: Date;
    draft?: QtyItem[];                  // quantities being edited right now (sending or confirming)
    sentItems?: QtyItem[];
    sentAt?: Date;
    askedAt?: Date;                     // the ordering branch was asked to confirm
    receivedItems?: QtyItem[];
    receivedAt?: Date;
    receivedBy?: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}
