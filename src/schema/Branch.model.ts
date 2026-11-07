import mongoose, { Schema } from 'mongoose';
import { ExpressType } from '../libs/enums/express.enum';

const branchSchema = new Schema(
    {
        name: {
            type: String,
            required: true,
            unique: true
        },
        lat: {
            type: Number,
            required: true
        },
        lng: {
            type: Number,
            required: true
        },
        orderGroupId: {
            type: Number,
        },
        express: {
            type: String,
            enum: ExpressType,   // Taksim Express or Troy Express; one branch each
        },
        expressGroupId: {
            type: Number,   // the group where orders to this Express branch arrive
        },
        expressSupplierIds: [{ type: Schema.Types.ObjectId, ref: 'Branch' }],   // the Express branches this branch may order from
        productIds: [{ type: Schema.Types.ObjectId, ref: 'Product' }],
        cleaningGroupId: {
            type: Number,
        },
        threadIds: {
            order: {
                type: Number,
            },
            ordered: {
                type: Number,
            },
            arrived: {
                type: Number,
            }
        },
    },
    { timestamps: true }
);

// one Taksim Express and one Troy Express: the database enforces it
branchSchema.index({ express: 1 }, { unique: true, partialFilterExpression: { express: { $type: 'string' } } });

export default mongoose.model('Branch', branchSchema);