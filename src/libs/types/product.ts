import { Types } from "mongoose";
import { ProductCategory } from "../enums/product.enum";

export interface Product {
    _id: Types.ObjectId;
    name: string;
    imageFileId?: string;   // Telegram file_id: a fast cache, the photo itself is the file below
    imageReference?: string;   // path of the photo inside the uploads folder on the server, e.g. "products/<id>-<time>.jpg"
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
    "name" | "category" | "imageFileId" | "code" | "orderLink" | "orderNote"
>;