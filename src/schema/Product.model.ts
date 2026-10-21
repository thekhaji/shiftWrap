import mongoose, { Schema } from 'mongoose';
import { Product } from '../libs/types/product';
import { ProductCategory } from '../libs/enums/product.enum';

const productSchema = new Schema<Product>(
    {
        name: { type: String, required: true, trim: true },
        imageFileId: { type: String },
        category: { type: String, enum: Object.values(ProductCategory), required: true },
        code: { type: String },
        orderLink: { type: String },
        orderNote: { type: String },
        isActive: { type: Boolean, default: true },
    },
    { timestamps: true }
);

// the catalog is shared by all branches, so a name is unique globally
productSchema.index({ name: 1 }, { unique: true });

export default mongoose.model<Product>('Product', productSchema);