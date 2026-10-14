import { Types } from "mongoose";

export interface Branch {
    _id: Types.ObjectId;
    name: string;
    lat: number;
    lng: number;
    orderGroupId?: number;
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