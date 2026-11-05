import mongoose, { Schema } from 'mongoose';
import { ExpressProduct } from '../libs/types/express';

// A product one Express branch sells to the other branches, with its own price.
const expressProductSchema = new Schema(
    {
        expressBranchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
        name: { type: String, required: true },
        price: { type: Number, required: true, min: 1 },
    },
    { timestamps: true }
);

expressProductSchema.index({ expressBranchId: 1, name: 1 }, { unique: true });

export default mongoose.model<ExpressProduct>('ExpressProduct', expressProductSchema);
