import mongoose, { Schema } from 'mongoose';

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

export default mongoose.model('Branch', branchSchema);