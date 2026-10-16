import { Types } from 'mongoose';
import ProductModel from '../schema/Product.model';
import { Product, ProductInput } from '../libs/types/product';
import Errors, { HttpCode, Message } from '../libs/Errors';

class ProductService {
    private readonly productModel = ProductModel;

    async getActiveProductsByBranch(branchId: Types.ObjectId): Promise<Product[]> {
        return this.productModel
            .find({ branchId, isActive: true })
            .sort({ name: 1 })
            .lean<Product[]>();
    }

    async getProductsByIds(ids: Types.ObjectId[]): Promise<Product[]> {
        return this.productModel.find({ _id: { $in: ids } }).lean<Product[]>();
    }

    async createProduct(input: ProductInput): Promise<Product> {
        if (!input.orderLink && !input.orderNote) {
            throw new Errors(HttpCode.BAD_REQUEST, Message.CREATE_FAILED); // needs a hint how to buy it
        }
        if (input.orderLink && !/^https?:\/\//i.test(input.orderLink)) {
            throw new Errors(HttpCode.BAD_REQUEST, Message.CREATE_FAILED); // Telegram URL buttons need http(s)
        }
        try {
            const product = await this.productModel.create(input);
            return product.toObject() as Product;
        } catch (err: any) {
            if (err.code === 11000) throw new Errors(HttpCode.CONFLICT, Message.EXISTING_USER); // add PRODUCT_EXISTS later
            throw err;
        }
    }
}

export default ProductService;