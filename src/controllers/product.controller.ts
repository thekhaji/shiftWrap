import { Bot } from 'grammy';
import { MyContext } from '../server';
import MemberService from '../models/Member.service';
import ProductService from '../models/Product.service';
import { ProductCategory } from '../libs/enums/product.enum';
import { isAdmin } from '../libs/utils/permission';
import { productStepView, productCategoryView } from '../views/index';
import { allLabels, allMenuLabels, t } from '../libs/i18n';

const memberService = new MemberService();
const productService = new ProductService();

// tapping a main-menu button cancels an unfinished add-product flow
const MENU_LABELS = allMenuLabels();

type Step = 'name' | 'category' | 'photo' | 'link' | 'note';

export function productController(bot: Bot<MyContext>) {

    async function askStep(ctx: MyContext, step: Step) {
        ctx.session.addProduct!.step = step;
        if (step === 'category') {
            const view = productCategoryView(ctx.lang);
            await ctx.reply(view.text, { reply_markup: view.keyboard });
            return;
        }
        const view = productStepView(ctx.lang, step);
        await ctx.reply(view.text, { reply_markup: view.keyboard });
    }

    async function finish(ctx: MyContext) {
        const w = ctx.session.addProduct!;
        if (!w.name || !w.category) {
            ctx.session.addProduct = undefined;
            await ctx.reply(t(ctx.lang, 'product.failedStart'));
            return;
        }
        if (!w.orderLink && !w.orderNote) {
            await ctx.reply(t(ctx.lang, 'product.needOne'));
            await askStep(ctx, 'link');
            return;
        }
        try {
            await productService.createProduct({
                name: w.name,
                category: w.category,
                imageFileId: w.imageFileId,
                orderLink: w.orderLink,
                orderNote: w.orderNote,
            });
            await ctx.reply(t(ctx.lang, 'product.added', { name: w.name }));
        } catch (err) {
            console.error("add product failed:", err);
            await ctx.reply(t(ctx.lang, 'product.saveFailed'));
        }
        ctx.session.addProduct = undefined;
    }

    // start: admin only, the product goes into the shared catalog
    bot.hears(allLabels('menu.addProduct'), async (ctx) => {
        if (!ctx.from) return;
        const member = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!member || !isAdmin(member)) {
            await ctx.reply(t(ctx.lang, 'common.noPermission'));
            return;
        }
        ctx.session.addProduct = { step: 'name' };
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
            await ctx.reply(t(ctx.lang, 'product.useButtons'));
        } else if (w.step === 'photo') {
            await ctx.reply(t(ctx.lang, 'product.sendPhoto'));
        } else if (w.step === 'link') {
            if (!/^https?:\/\//i.test(text)) {
                await ctx.reply(t(ctx.lang, 'product.linkFormat'));
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
        await ctx.editMessageText(t(ctx.lang, 'common.cancelled'));
    });
}