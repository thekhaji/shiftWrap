import { Types } from "mongoose";
import { ProductCategory } from "../enums/product.enum";

export interface Product {
    _id: Types.ObjectId;
    branchId: Types.ObjectId;
    name: string;
    imageFileId?: string;   // Telegram file_id, not the image itself
    category: ProductCategory;
    code?: string;
    orderLink?: string;     // http(s) URL, e.g. Coupang
    orderNote?: string;     // how it is usually ordered
    isActive: boolean;      // false = archived (soft delete)
    createdAt: Date;
    updatedAt: Date;
}

export type ProductInput = Pick <
    Product,
    "branchId" | "name" | "category" | "imageFileId" | "code" | "orderLink" | "orderNote"
>;