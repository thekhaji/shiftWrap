import BranchModel from '../schema/Branch.model';
import { Branch, BranchInput } from '../libs/types/branch';
import Errors, { Message, HttpCode } from '../libs/Errors';
import { Types } from 'mongoose';

class BranchService {
    private readonly branchModel;

    constructor() {
        this.branchModel = BranchModel;
    }

    async getAllBranches(): Promise<Branch[]> {
        const branches = await this.branchModel.find();
        return branches.map(branch => branch.toObject() as Branch);
    }

    async getBranchById(branchId: Types.ObjectId): Promise<Branch | null> {
        const branch = await this.branchModel.findById(branchId);
        return branch ? (branch.toObject() as Branch) : null;
    }

    async getBranchesByIds(branchIds: Types.ObjectId[]): Promise<Branch[]> {
        const branches = await this.branchModel.find({ _id: { $in: branchIds } });
        return branches.map(b => b.toObject() as Branch);
    }

    async createBranch(branchData: BranchInput): Promise<Branch> {
        try {
            const newBranch = await this.branchModel.create(branchData);
            return newBranch.toObject() as Branch;
        } catch (err: any) {
            if (err.code === 11000) throw new Errors(HttpCode.CONFLICT, Message.EXISTING_BRANCH);
            throw err;
        }
    }

    async updateBranch(branchId: string, branchData: Partial<Branch>): Promise<Branch | null> {
        const updatedBranch = await this.branchModel.findByIdAndUpdate(branchId, branchData, { new: true });
        return updatedBranch ? (updatedBranch.toObject() as Branch) : null;
    }

    // grant or revoke one product for a branch storage
    async setProductAccess(branchId: Types.ObjectId, productId: Types.ObjectId, granted: boolean): Promise<Branch | null> {
        const update = granted ? { $addToSet: { productIds: productId } } : { $pull: { productIds: productId } };
        const branch = await this.branchModel.findByIdAndUpdate(branchId, update, { new: true });
        return branch ? (branch.toObject() as Branch) : null;
    }

    async deleteBranch(branchId: string): Promise<Branch | null> {
        const deletedBranch = await this.branchModel.findByIdAndDelete(branchId);
        return deletedBranch ? (deletedBranch.toObject() as Branch) : null;
    }

    private getDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
        const R = 6371000; // Earth's radius in meters
        const toRad = (deg: number) => (deg * Math.PI) / 180;

        const dLat = toRad(lat2 - lat1);
        const dLng = toRad(lng2 - lng1);

        const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;

        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return R * c; // distance in meters
    }

    async findNearestBranch(lat: number, lng: number): Promise<{ branch: Branch; distance: number }> {
        const branches = await this.getAllBranches();
        let nearest: { branch: Branch; distance: number } | null = null;

        for (const branch of branches) {
            const distance = this.getDistanceMeters(lat, lng, branch.lat, branch.lng);
            if (distance <= 50 && (!nearest || distance < nearest.distance)) {
                nearest = { branch, distance };
            }
        }

        if (!nearest) {
            throw new Errors(HttpCode.NOT_FOUND, Message.NO_BRANCH_NEARBY);
        }

        return nearest;
    }
}

export default BranchService;
