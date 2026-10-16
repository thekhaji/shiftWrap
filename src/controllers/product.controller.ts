import { Bot, InlineKeyboard } from 'grammy';
import { Types } from 'mongoose';
import { MyContext } from '../server';
import MemberService from '../models/Member.service';
import BranchService from '../models/Branch.service';
import ProductService from '../models/Product.service';
import { ProductCategory } from '../libs/enums/product.enum';
import { hasManagerPermission, isBossOrAdmin } from '../libs/utils/permission';
import { productStepView, productCategoryView } from '../views/index';

const memberService = new MemberService();
const branchService = new BranchService();
const productService = new ProductService();

// tapping a main-menu button cancels an unfinished add-product flow
const MENU_LABELS = new Set([
    "✅ Check In", "🚪 Check Out", "📊 Hisobot", "🏢 Filial hisoboti", "📦 Ombor",
]);

type Step = 'name' | 'category' | 'photo' | 'link' | 'note';

export function productController(bot: Bot<MyContext>) {

    async function askStep(ctx: MyContext, step: Step) {
        ctx.session.addProduct!.step = step;
        if (step === 'category') {
            const view = productCategoryView();
            await ctx.reply(view.text, { reply_markup: view.keyboard });
            return;
        }
        const view = productStepView(step);
        await ctx.reply(view.text, { reply_markup: view.keyboard });
    }

    async function finish(ctx: MyContext) {
        const w = ctx.session.addProduct!;
        if (!w.name || !w.category) {
            ctx.session.addProduct = undefined;
            await ctx.reply("Xatolik yuz berdi. Qaytadan boshlang.");
            return;
        }
        if (!w.orderLink && !w.orderNote) {
            await ctx.reply("Havola yoki izohdan kamida bittasi kerak.");
            await askStep(ctx, 'link');
            return;
        }
        try {
            await productService.createProduct({
                branchId: new Types.ObjectId(w.branchId),
                name: w.name,
                category: w.category,
                imageFileId: w.imageFileId,
                orderLink: w.orderLink,
                orderNote: w.orderNote,
            });
            await ctx.reply(`✅ "${w.name}" qo'shildi.`);
        } catch (err) {
            console.error("add product failed:", err);
            await ctx.reply("Mahsulotni saqlab bo'lmadi. Nom takrorlangan bo'lishi mumkin yoki havola noto'g'ri.");
        }
        ctx.session.addProduct = undefined;
    }

    // start: managers use their own branch, boss/admin pick one
    bot.callbackQuery("product_add", async (ctx) => {
        const member = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!member || !hasManagerPermission(member)) {
            await ctx.answerCallbackQuery({ text: "Ruxsat yo'q." });
            return;
        }
        await ctx.answerCallbackQuery();
        if (isBossOrAdmin(member)) {
            const branches = await branchService.getAllBranches();
            const keyboard = new InlineKeyboard();
            for (const b of branches) keyboard.text(b.name, `product_branch:${b._id.toString()}`).row();
            await ctx.reply("Qaysi filial uchun?", { reply_markup: keyboard });
            return;
        }
        ctx.session.addProduct = { step: 'name', branchId: member.branchId!.toString() };
        await askStep(ctx, 'name');
    });

    bot.callbackQuery(/^product_branch:/, async (ctx) => {
        const member = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!member || !isBossOrAdmin(member)) {
            await ctx.answerCallbackQuery({ text: "Ruxsat yo'q." });
            return;
        }
        await ctx.answerCallbackQuery();
        ctx.session.addProduct = { step: 'name', branchId: ctx.callbackQuery.data.split(':')[1] };
        await askStep(ctx, 'name');
    });

    // category chosen
    bot.callbackQuery(/^product_cat:/, async (ctx) => {
        const w = ctx.session.addProduct;
        await ctx.answerCallbackQuery();
        if (!w || w.step !== 'category') return; // stale button
        const cat = ctx.callbackQuery.data.split(':')[1] as ProductCategory;
        if (!Object.values(ProductCategory).includes(cat)) return;
        w.category = cat;
        await askStep(ctx, 'photo');
    });

    // text answers: name, link, note
    bot.on("message:text", async (ctx, next) => {
        const w = ctx.session.addProduct;
        if (!w) return next();

        const text = ctx.message.text.trim();
        if (MENU_LABELS.has(text)) {
            ctx.session.addProduct = undefined;
            return next();
        }

        if (w.step === 'name') {
            w.name = text;
            await askStep(ctx, 'category');
        } else if (w.step === 'category') {
            await ctx.reply("Guruhni tugmalardan tanlang.");
        } else if (w.step === 'photo') {
            await ctx.reply("Rasm yuboring yoki o'tkazib yuboring.");
        } else if (w.step === 'link') {
            if (!/^https?:\/\//i.test(text)) {
                await ctx.reply("Havola http:// yoki https:// bilan boshlanishi kerak.");
                return;
            }
            w.orderLink = text;
            await askStep(ctx, 'note');
        } else if (w.step === 'note') {
            w.orderNote = text;
            await finish(ctx);
        }
    });

    bot.on("message:photo", async (ctx, next) => {
        const w = ctx.session.addProduct;
        if (!w || w.step !== 'photo') return next();
        w.imageFileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        await askStep(ctx, 'link');
    });

    bot.callbackQuery("product_skip", async (ctx) => {
        const w = ctx.session.addProduct;
        await ctx.answerCallbackQuery();
        if (!w) return;
        if (w.step === 'photo') await askStep(ctx, 'link');
        else if (w.step === 'link') await askStep(ctx, 'note');
        else if (w.step === 'note') await finish(ctx);
    });

    bot.callbackQuery("product_cancel", async (ctx) => {
        ctx.session.addProduct = undefined;
        await ctx.answerCallbackQuery();
        await ctx.editMessageText("Bekor qilindi.");
    });
}