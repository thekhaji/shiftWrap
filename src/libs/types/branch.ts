import { Types } from "mongoose";
import { ExpressType } from "../enums/express.enum";

export interface Branch {
    _id: Types.ObjectId;
    name: string;
    lat: number;
    lng: number;
    orderGroupId?: number;
    express?: ExpressType;                // this branch is Taksim Express or Troy Express
    expressGroupId?: number;              // Express branch only: the group that receives the orders
    expressSupplierIds?: Types.ObjectId[];   // the Express branches this branch may order products from (one or both)
    productIds?: Types.ObjectId[];  // products this branch storage may order, set by admin
    cleaningGroupId?: number;   // group that receives the weekly cleaning slides
    threadIds?:{
        "order": number;
        "ordered": number;
        "arrived": number;
    };
    createdAt: Date;
    updatedAt: Date;
}

export interface BranchInput {
    name: string;
    lat: number;
    lng: number;
}