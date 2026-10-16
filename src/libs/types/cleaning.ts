import { Types } from "mongoose";
import { CleaningPlace } from "../enums/cleaning.enum";

// one accepted pair = a before photo + an after photo for one place
export interface CleaningPair {
    _id: Types.ObjectId;
    branchId: Types.ObjectId;
    memberId: Types.ObjectId;
    memberName: string;         // snapshot at upload time
    place: CleaningPlace;
    beforeFileId: string;       // Telegram file_id
    afterFileId: string;
    weekStart: Date;            // Monday 00:00 Seoul, in the "Seoul labeled as UTC" convention
    createdAt: Date;
    updatedAt: Date;
}

export type CleaningPairInput = Pick<
    CleaningPair,
    "branchId" | "memberId" | "memberName" | "place" | "beforeFileId" | "afterFileId" | "weekStart"
>;

// "it is all from me": the member finished their cleaning uploads for the week
export interface CleaningDone {
    _id: Types.ObjectId;
    branchId: Types.ObjectId;
    memberId: Types.ObjectId;
    memberName: string;
    weekStart: Date;
    createdAt: Date;
    updatedAt: Date;
}
