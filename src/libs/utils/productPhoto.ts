import { Api, InputFile } from 'grammy';
import ProductModel from '../../schema/Product.model';
import ProductImageService from '../../models/ProductImage.service';
import { Product } from '../types/product';

const images = new ProductImageService();

// Send a product photo. The Telegram file_id is tried first (fast); if Telegram no longer accepts it,
// the file in the server's uploads folder is uploaded instead and the file_id is refreshed.
// Throws when there is no photo to send, so the caller can fall back to text.
export async function sendProductPhoto<T extends { photo?: { file_id: string }[] }>(
    api: Api, product: Product, send: (photo: string | InputFile) => Promise<T>,
): Promise<T> {
    if (product.imageFileId) {
        try {
            return await send(product.imageFileId);
        } catch (err) {
            console.error(`file_id of ${product.name} not accepted, using the stored file:`, err);
        }
    }
    const file = product.imageReference ? images.absolutePath(product.imageReference) : null;
    if (!file || !(await images.exists(product.imageReference!))) throw new Error(`no image file for ${product.name}`);
    const sent = await send(new InputFile(file));
    const fresh = sent.photo?.[sent.photo.length - 1]?.file_id;
    if (fresh) await ProductModel.updateOne({ _id: product._id }, { $set: { imageFileId: fresh } }).catch(() => {});
    return sent;
}
