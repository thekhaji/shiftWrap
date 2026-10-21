import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import ProductModel from '../schema/Product.model';
import BranchModel from '../schema/Branch.model';

// One-off: products used to belong to a single branch (product.branchId). They are now one
// shared catalog and each branch lists the products it may order (branch.productIds).
// Same-named products from different branches are merged into one; every branch that had
// one keeps access to it.
async function main() {
    await mongoose.connect(process.env.MONGO_URL as string);
    const col = ProductModel.collection;

    const legacy = await col.find({ branchId: { $exists: true } }).toArray();
    console.log(`Migrating ${legacy.length} product(s)...`);

    const keeperByName = new Map<string, any>();
    for (const p of await col.find({ branchId: { $exists: false } }).toArray()) keeperByName.set(p.name, p);

    for (const p of legacy) {
        const keeper = keeperByName.get(p.name) ?? p;
        keeperByName.set(p.name, keeper);
        await BranchModel.updateOne({ _id: p.branchId }, { $addToSet: { productIds: keeper._id } });
        if (keeper._id.equals(p._id)) await col.updateOne({ _id: p._id }, { $unset: { branchId: '' } });
        else await col.deleteOne({ _id: p._id });
    }

    // the old per-branch unique index would block the new global one
    await col.dropIndex('branchId_1_name_1').catch(() => {});
    await ProductModel.syncIndexes();
    console.log('Done.');
    await mongoose.disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
