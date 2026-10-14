import mongoose, { Schema } from 'mongoose';
import { Product } from '../libs/types/product';

const productSchema = new Schema<Product>(
    {
        branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
        name: { type: String, required: true, trim: true },
        imageFileId: { type: String },
        code: { type: String },
        orderLink: { type: String },
        orderNote: { type: String },
        isActive: { type: Boolean, default: true },
    },
    { timestamps: true }
);

// A branch can't list the same product name twice; different branches may share names.
productSchema.index({ branchId: 1, name: 1 }, { unique: true });

export default mongoose.model<Product>('Product', productSchema);