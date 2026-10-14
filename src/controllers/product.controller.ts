import { Bot } from 'grammy';
import { Types } from 'mongoose';
import { MyContext } from '../server';
import MemberService from '../models/Member.service';
import BranchService from '../models/Branch.service';
import ProductService from '../models/Product.service';
import { hasManagerPermission, isBossOrAdmin } from '../libs/utils/permission';
import { productStepView } from '../views/index';
import { InlineKeyboard } from 'grammy';

const memberService = new MemberService();
const branchService = new BranchService();
const productService = new ProductService();

export function productController(bot: Bot<MyContext>) {

    async function askStep(ctx: MyContext, step: 'name' | 'photo' | 'link' | 'note') {
        ctx.session.addProduct!.step = step;
        const view = productStepView(step);
        await ctx.reply(view.text, { reply_markup: view.keyboard });
    }

    async function finish(ctx: MyContext) {
        const w = ctx.session.addProduct!;
        if (!w.orderLink && !w.orderNote) {
            await ctx.reply("Havola yoki izohdan kamida bittasi kerak.");
            await askStep(ctx, 'link');
            return;
        }
        try {
            await productService.createProduct({
                branchId: new Types.ObjectId(w.branchId),
                name: w.name!,
                imageFileId: w.imageFileId,
                orderLink: w.orderLink,
                orderNote: w.orderNote,
            } as any);
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

    // text answers: name, link, note
    bot.on("message:text", async (ctx, next) => {
        const w = ctx.session.addProduct;
        if (!w) return next();               // not in the flow: let other handlers run
        const text = ctx.message.text.trim();
        if (w.step === 'name') { w.name = text; await askStep(ctx, 'photo'); }
        else if (w.step === 'photo') { await ctx.reply("Rasm yuboring yoki o'tkazib yuboring."); }
        else if (w.step === 'link') {
            if (!/^https?:\/\//i.test(text)) { await ctx.reply("Havola http:// yoki https:// bilan boshlanishi kerak."); return; }
            w.orderLink = text; await askStep(ctx, 'note');
        }
        else if (w.step === 'note') { w.orderNote = text; await finish(ctx); }
    });

    // photo answer
    bot.on("message:photo", async (ctx, next) => {
        const w = ctx.session.addProduct;
        if (!w || w.step !== 'photo') return next();
        w.imageFileId = ctx.message.photo[ctx.message.photo.length - 1].file_id; // largest size
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