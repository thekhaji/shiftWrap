import { Types } from "mongoose";

export interface Product {
    _id: Types.ObjectId;
    branchId: Types.ObjectId;
    name: string;
    imageFileId?: string;   // Telegram file_id, not the image itself
    code?: string;          // barcode / SKU text
    orderLink?: string;     // Coupang or other http(s) URL
    orderNote?: string;     // how it is usually ordered
    isActive: boolean;      // false = archived (soft delete)
    createdAt: Date;
    updatedAt: Date;
}

export type ProductInput = Pick<
    Product,
    "branchId" | "name" | "imageFileId" | "code" | "orderLink" | "orderNote"
>;