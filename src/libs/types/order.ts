import { Types } from "mongoose";
import { OrderStatus } from "../enums/order.enum";

export interface OrderItem {
    productId: Types.ObjectId;
    name: string;               // snapshot at order time
}

export interface Order {
    _id: Types.ObjectId;
    branchId: Types.ObjectId;
    requestedBy: Types.ObjectId;    // member
    status: OrderStatus;
    items: OrderItem[];
    orderedBy?: Types.ObjectId;
    receivedBy?: Types.ObjectId;
    groupMessageId?: number;        // the message currently shown in the group
    createdAt: Date;
    updatedAt: Date;
}