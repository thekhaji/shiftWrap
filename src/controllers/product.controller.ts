import { Bot } from 'grammy';
import { MyContext } from '../server';
import MemberService from '../models/Member.service';
import ProductService from '../models/Product.service';
import ProductImageService from '../models/ProductImage.service';
import { sendProductPhoto } from '../libs/utils/productPhoto';
import { ProductCategory } from '../libs/enums/product.enum';
import { isAdmin } from '../libs/utils/permission';
import { productStepView, productCategoryView, productArchiveView, storageProductView, productCategoryEditView, productEditPromptView, storageListView } from '../views/index';
import { Product } from '../libs/types/product';
import Errors, { Message } from '../libs/Errors';
import { allLabels, allMenuLabels, t } from '../libs/i18n';

const memberService = new MemberService();
const productService = new ProductService();
const imageService = new ProductImageService();

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
            const created = await productService.createProduct({
                name: w.name,
                category: w.category,
                imageFileId: w.imageFileId,
                orderLink: w.orderLink,
                orderNote: w.orderNote,
            });
            if (w.imageFileId) await imageService.saveFromTelegram(ctx.api, created._id, w.imageFileId);
            await ctx.reply(t(ctx.lang, 'product.added', { name: w.name }));
            ctx.session.addProduct = undefined;
            await sendList(ctx);
        } catch (err) {
            console.error("add product failed:", err);
            await ctx.reply(t(ctx.lang, 'product.saveFailed'));
        }
        ctx.session.addProduct = undefined;
    }

    // ---- the admin's Storage: the whole catalog, add / edit / photo / remove ----

    async function adminFrom(ctx: MyContext) {
        const member = ctx.from ? await memberService.getMemberByTelegramId(ctx.from.id) : null;
        return member && isAdmin(member) ? member : null;
    }

    async function adminCallback(ctx: MyContext) {
        const admin = await adminFrom(ctx);
        if (!admin) await ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.noPermissionShort') });
        return admin;
    }

    async function sendList(ctx: MyContext, page = 0, edit = false) {
        const view = storageListView(ctx.lang, await productService.getAllActiveProducts(), page);
        if (edit) await ctx.editMessageText(view.text, { reply_markup: view.keyboard }).catch(() => {});
        else await ctx.reply(view.text, { reply_markup: view.keyboard });
    }

    // the card shows the photo when there is one
    async function sendCard(ctx: MyContext, product: Product) {
        const view = storageProductView(ctx.lang, product);
        try {
            await sendProductPhoto(ctx.api, product, (photo) => ctx.replyWithPhoto(photo, { caption: view.text, reply_markup: view.keyboard }));
        } catch {
            await ctx.reply(view.text, { reply_markup: view.keyboard });   // no photo: text
        }
    }

    bot.hears(allLabels('menu.storage'), async (ctx) => {
        if (!(await adminFrom(ctx))) {
            await ctx.reply(t(ctx.lang, 'common.noPermission'));
            return;
        }
        await sendList(ctx);
    });

    bot.callbackQuery('st_noop', (ctx) => ctx.answerCallbackQuery());

    bot.callbackQuery(/^st_l:/, async (ctx) => {
        if (!(await adminCallback(ctx))) return;
        await ctx.answerCallbackQuery();
        await sendList(ctx, Number(ctx.callbackQuery.data.split(':')[1]) || 0, true);
    });

    // start adding: the product goes into the shared catalog
    bot.callbackQuery('st_add', async (ctx) => {
        if (!(await adminCallback(ctx))) return;
        await ctx.answerCallbackQuery();
        ctx.session.editProduct = undefined;
        ctx.session.addProduct = { step: 'name' };
        await askStep(ctx, 'name');
    });

    async function openCard(ctx: MyContext, replaceCurrent: boolean) {
        if (!(await adminCallback(ctx))) return;
        const product = await productService.getProduct(ctx.callbackQuery!.data!.split(':')[1]);
        if (!product) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.errorShort') });
            return;
        }
        await ctx.answerCallbackQuery();
        ctx.session.editProduct = undefined;
        if (replaceCurrent) await ctx.deleteMessage().catch(() => {});   // back from the category / remove screen
        await sendCard(ctx, product);
    }

    bot.callbackQuery(/^st_p:/, (ctx) => openCard(ctx, false));
    bot.callbackQuery(/^st_pb:/, (ctx) => openCard(ctx, true));

    bot.callbackQuery('st_cl', async (ctx) => {
        await ctx.answerCallbackQuery();
        ctx.session.editProduct = undefined;
        await ctx.deleteMessage().catch(() => {});
    });

    // change name / link / note / photo: the next message is the new value
    bot.callbackQuery(/^st_e:/, async (ctx) => {
        if (!(await adminCallback(ctx))) return;
        const [, id, field] = ctx.callbackQuery.data.split(':');
        const product = await productService.getProduct(id);
        if (!product || !['name', 'link', 'note', 'photo'].includes(field)) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.errorShort') });
            return;
        }
        await ctx.answerCallbackQuery();
        ctx.session.addProduct = undefined;
        ctx.session.editProduct = { productId: id, field: field as 'name' | 'link' | 'note' | 'photo', cardMessageId: ctx.callbackQuery.message?.message_id };
        const view = productEditPromptView(ctx.lang, field as 'name' | 'link' | 'note' | 'photo');
        await ctx.reply(view.text, { reply_markup: view.keyboard });
    });

    bot.callbackQuery('st_edcancel', async (ctx) => {
        ctx.session.editProduct = undefined;
        await ctx.answerCallbackQuery();
        await ctx.deleteMessage().catch(() => {});
    });

    bot.callbackQuery(/^st_ec:/, async (ctx) => {
        if (!(await adminCallback(ctx))) return;
        const id = ctx.callbackQuery.data.split(':')[1];
        if (!(await productService.getProduct(id))) return ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.errorShort') });
        await ctx.answerCallbackQuery();
        const view = productCategoryEditView(ctx.lang, id);
        // a photo card has a caption, not text
        if (ctx.callbackQuery.message?.caption !== undefined) await ctx.editMessageCaption({ caption: view.text, reply_markup: view.keyboard }).catch(() => {});
        else await ctx.editMessageText(view.text, { reply_markup: view.keyboard }).catch(() => {});
    });

    bot.callbackQuery(/^st_c:/, async (ctx) => {
        if (!(await adminCallback(ctx))) return;
        const [, id, cat] = ctx.callbackQuery.data.split(':');
        if (!Object.values(ProductCategory).includes(cat as ProductCategory)) return ctx.answerCallbackQuery();
        const updated = await productService.updateProduct(id, { category: cat as ProductCategory });
        if (!updated) return ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.errorShort') });
        await ctx.answerCallbackQuery({ text: t(ctx.lang, 'st.updated') });
        await ctx.deleteMessage().catch(() => {});
        await sendCard(ctx, updated);
    });

    bot.callbackQuery(/^st_x:/, async (ctx) => {
        if (!(await adminCallback(ctx))) return;
        const product = await productService.getProduct(ctx.callbackQuery.data.split(':')[1]);
        if (!product) return ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.errorShort') });
        await ctx.answerCallbackQuery();
        const view = productArchiveView(ctx.lang, product);
        if (ctx.callbackQuery.message?.caption !== undefined) await ctx.editMessageCaption({ caption: view.text, reply_markup: view.keyboard }).catch(() => {});
        else await ctx.editMessageText(view.text, { reply_markup: view.keyboard }).catch(() => {});
    });

    bot.callbackQuery(/^st_xy:/, async (ctx) => {
        if (!(await adminCallback(ctx))) return;
        const archived = await productService.archiveProduct(ctx.callbackQuery.data.split(':')[1]);
        if (!archived) return ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.errorShort') });
        await ctx.answerCallbackQuery({ text: t(ctx.lang, 'st.archived', { name: archived.name }) });
        await ctx.deleteMessage().catch(() => {});
        await sendList(ctx);
    });

    async function applyEdit(ctx: MyContext, patch: Parameters<ProductService['updateProduct']>[1]): Promise<boolean> {
        const edit = ctx.session.editProduct!;
        try {
            const updated = await productService.updateProduct(edit.productId, patch);
            if (!updated) {
                ctx.session.editProduct = undefined;
                await ctx.reply(t(ctx.lang, 'common.errorShort'));
                return false;
            }
            ctx.session.editProduct = undefined;
            await ctx.reply(t(ctx.lang, 'st.updated'));
            if (edit.cardMessageId && ctx.chat) await ctx.api.deleteMessage(ctx.chat.id, edit.cardMessageId).catch(() => {});
            await sendCard(ctx, updated);
            return true;
        } catch (err) {
            await ctx.reply(t(ctx.lang, err instanceof Errors && err.message === Message.EXISTING_PRODUCT ? 'st.nameTaken' : 'st.invalid'));
            return false;
        }
    }

    bot.on("message:text", async (ctx, next) => {
        const edit = ctx.session.editProduct;
        if (!edit) return next();
        const text = ctx.message.text.trim();
        if (MENU_LABELS.has(text)) {
            ctx.session.editProduct = undefined;
            return next();
        }
        if (!(await adminFrom(ctx))) {
            ctx.session.editProduct = undefined;
            return next();
        }
        if (edit.field === 'photo') {
            await ctx.reply(t(ctx.lang, 'product.sendPhoto'));
        } else if (edit.field === 'name') {
            if (text) await applyEdit(ctx, { name: text.slice(0, 80) });
        } else if (edit.field === 'link') {
            if (!/^https?:\/\//i.test(text)) await ctx.reply(t(ctx.lang, 'product.linkFormat'));
            else await applyEdit(ctx, { orderLink: text });
        } else if (text) {
            await applyEdit(ctx, { orderNote: text });
        }
    });

    // the new photo replaces the old one; only its Telegram file_id is stored, never the image
    bot.on("message:photo", async (ctx, next) => {
        const edit = ctx.session.editProduct;
        if (!edit || edit.field !== 'photo' || !(await adminFrom(ctx))) return next();
        const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        if (await applyEdit(ctx, { imageFileId: fileId })) await imageService.saveFromTelegram(ctx.api, edit.productId, fileId);
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