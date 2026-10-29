import mongoose, { Schema, SchemaType } from 'mongoose';
import {MemberType, MemberStatus, ManagerRole} from '../libs/enums/member.enum';

const memberSchema = new Schema({
    telegramId: { 
        type: Number, 
        required: true, 
        unique: true 
    },
    name: { 
        type: String, 
        required: true 
    },
    username: { 
        type: String, 
        unique: true,
        sparse: true
    },
    phone: { 
        type: String, 
        required: true 
    },
    language: {
        type: String,
        enum: ['uz', 'tr', 'en'],
        default: 'uz'
    },
    type: { 
        type: String, 
        enum: MemberType, 
        default: MemberType.USER 
    },
    managerRole: {
        type: String,
        enum: ManagerRole   // only for type MANAGER; unset = MAIN
    },
    status: { 
        type: String, 
        enum: MemberStatus, 
        default: MemberStatus.ACTIVE 
    },
    branchId: {
        type: Schema.Types.ObjectId, //set by Boss/Admin
        ref: 'Branch'
    },
    hourlyRate: { 
        type: Number //set by manager
    }, 
    bankName: { 
        type: String //set by manager
    },  
    bankAccount: { 
        type: String //set by manager
    }, 
},
    {timestamps: true}
);

export default mongoose.model('Member', memberSchema);

