import { Api } from 'grammy';
import fs from 'fs/promises';
import path from 'path';
import { Types } from 'mongoose';
import ProductModel from '../schema/Product.model';
import { uploadsDir } from '../libs/utils/config';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;   // Telegram photos are far smaller; this only stops a bad download
const FOLDER = 'products';

// Product photos live as files in the uploads folder on the server;
// the product's imageReference is the file's path inside that folder, e.g. "products/66f0…-1730800000000.jpg".
class ProductImageService {
    // the full path of a reference; null when it points outside the uploads folder
    absolutePath(reference: string): string | null {
        const root = path.resolve(uploadsDir());
        const full = path.resolve(root, reference);
        return full.startsWith(root + path.sep) ? full : null;
    }

    private async download(api: Api, fileId: string): Promise<Buffer> {
        const file = await api.getFile(fileId);
        const res = await fetch(`https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`);
        if (!res.ok) throw new Error(`photo download failed: ${res.status}`);
        const data = Buffer.from(await res.arrayBuffer());
        if (data.length > MAX_IMAGE_BYTES) throw new Error('photo too large');
        return data;
    }

    // download the Telegram photo into the uploads folder and point the product at it;
    // the previous file of that product is deleted. false = it could not be saved
    async saveFromTelegram(api: Api, productId: Types.ObjectId | string, fileId: string): Promise<boolean> {
        try {
            const data = await this.download(api, fileId);
            const reference = `${FOLDER}/${productId}-${Date.now()}.jpg`;
            const target = this.absolutePath(reference)!;
            await fs.mkdir(path.dirname(target), { recursive: true });
            const temp = `${target}.tmp`;
            await fs.writeFile(temp, data);
            await fs.rename(temp, target);   // never a half-written image

            const before = await ProductModel.findByIdAndUpdate(productId, { $set: { imageReference: reference } }).select('imageReference').lean();
            if (!before) {
                await fs.unlink(target).catch(() => {});
                return false;
            }
            if (before.imageReference) await this.remove(before.imageReference);
            return true;
        } catch (err: any) {
            // Telegram refusing the file_id is expected for photos another bot saved: one line, not a stack trace
            if (err?.error_code === 400) console.warn(`product ${productId}: Telegram does not accept its photo (${err.description}); upload the photo again`);
            else console.error(`saving image of product ${productId} failed:`, err);
            return false;
        }
    }

    async remove(reference: string): Promise<void> {
        const full = this.absolutePath(reference);
        if (full) await fs.unlink(full).catch(() => {});
    }

    // does the referenced file exist on the server?
    async exists(reference: string): Promise<boolean> {
        const full = this.absolutePath(reference);
        return !!full && (await fs.stat(full).then(s => s.isFile()).catch(() => false));
    }

    // photos added before they were kept on the server (or whose file is gone): fetch them again from Telegram
    async backfill(api: Api): Promise<void> {
        const products = await ProductModel.find({ imageFileId: { $exists: true, $ne: null } }).select('imageFileId imageReference').lean();
        for (const p of products) {
            if (p.imageFileId && !(p.imageReference && await this.exists(p.imageReference))) {
                await this.saveFromTelegram(api, p._id, p.imageFileId);
            }
        }
    }
}

export default ProductImageService;
