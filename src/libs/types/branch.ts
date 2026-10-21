import { Types } from "mongoose";

export interface Branch {
    _id: Types.ObjectId;
    name: string;
    lat: number;
    lng: number;
    orderGroupId?: number;
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