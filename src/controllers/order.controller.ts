import { Bot } from 'grammy';
import { Types } from 'mongoose';
import { MyContext } from '../server';
import MemberService from '../models/Member.service';
import BranchService from '../models/Branch.service';
import ProductService from '../models/Product.service';
import OrderService from '../models/Order.service';
import { ProductCategory } from '../libs/enums/product.enum';
import { allLabels, t } from '../libs/i18n';
import { Order } from '../libs/types/order';
import { hasManagerPermission, isBossOrAdmin, isManagerOf } from '../libs/utils/permission';
import { productCardView, orderCategoryView, orderControlView, orderMessageView, orderReviewView, storageMenuView } from '../views/index';

const memberService = new MemberService();
const branchService = new BranchService();
const productService = new ProductService();
const orderService = new OrderService();

export function orderController(bot: Bot<MyContext>) {

    // delete the catalog cards (and control message) from the chat
    async function clearBasket(ctx: MyContext) {
        const ids = ctx.session.basketMessageIds ?? [];
        ctx.session.basketMessageIds = undefined;
        if (!ctx.chat) return;
        for (const id of ids) {
            await ctx.api.deleteMessage(ctx.chat.id, id).catch(() => {});
        }
    }

    // 1. Open the storage menu
    bot.hears(allLabels('menu.storage'), async (ctx) => {
        if (!ctx.from) return;
        const member = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!member || !hasManagerPermission(member)) {
            await ctx.reply(t(ctx.lang, 'common.noPermission'));
            return;
        }
        const view = storageMenuView(ctx.lang);
        await ctx.reply(view.text, { reply_markup: view.keyboard });
    });

    // 2. Show the category list
    async function showCategories(ctx: MyContext, branchId: Types.ObjectId) {
        const products = await productService.getActiveProductsByBranch(branchId);
        if (products.length === 0) {
            await ctx.reply(t(ctx.lang, 'order.noProducts'));
            return;
        }
        const counts = new Map<ProductCategory, number>();
        let uncategorized = 0;
        for (const p of products) {
            if (p.category) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
            else uncategorized++;
        }

        await clearBasket(ctx); // reopening removes the old cards
        const view = orderCategoryView(ctx.lang, counts, uncategorized);
        const msg = await ctx.reply(view.text, { reply_markup: view.keyboard });
        ctx.session.basketMessageIds = [msg.message_id];
    }

    bot.callbackQuery(["order_start", "order_categories"], async (ctx) => {
        await ctx.answerCallbackQuery();
        const member = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!member || !hasManagerPermission(member)) {
            await ctx.reply(t(ctx.lang, 'common.noPermission'));
            return;
        }
        if (!member.branchId) {
            // boss/admin have no branch of their own
            await ctx.reply(t(ctx.lang, 'order.bossLater'));
            return;
        }
        await showCategories(ctx, member.branchId);
    });

    // 2b. A category was chosen: one photo card per product in it
    bot.callbackQuery(/^order_cat:/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const member = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!member || !hasManagerPermission(member) || !member.branchId) {
            await ctx.reply(t(ctx.lang, 'common.noPermission'));
            return;
        }
        const key = ctx.callbackQuery.data.split(':')[1];
        const isNone = key === 'NONE';
        const cat = key as ProductCategory;
        if (!isNone && !Object.values(ProductCategory).includes(cat)) return;

        const all = await productService.getActiveProductsByBranch(member.branchId);
        const products = all.filter(p => isNone ? !p.category : p.category === cat);
        if (products.length === 0) {
            await showCategories(ctx, member.branchId);
            return;
        }

        await clearBasket(ctx); // removes the category menu
        const draft = await orderService.getOrCreateDraft(member._id, member.branchId);
        const selected = new Set(draft.items.map(i => i.productId.toString()));

        const sentIds: number[] = [];
        for (const p of products) {
            const view = productCardView(ctx.lang, p, selected.has(p._id.toString()));
            let msg;
            if (p.imageFileId) {
                try {
                    msg = await ctx.replyWithPhoto(p.imageFileId, {
                        caption: view.text,
                        reply_markup: view.keyboard,
                    });
                } catch (err) {
                    console.error(`bad imageFileId for ${p.name}:`, err);
                    msg = await ctx.reply(view.text, { reply_markup: view.keyboard }); // fall back to text
                }
            } else {
                msg = await ctx.reply(view.text, { reply_markup: view.keyboard });
            }
            sentIds.push(msg.message_id);
        }

        const control = orderControlView(ctx.lang);
        const controlMsg = await ctx.reply(`${isNone ? t(ctx.lang, 'order.uncategorized') : t(ctx.lang, `cat.${cat}`)}\n${control.text}`, { reply_markup: control.keyboard });
        sentIds.push(controlMsg.message_id);
        ctx.session.basketMessageIds = sentIds;
    });

    // 3. Toggle a product (redraws only the tapped card)
    bot.callbackQuery(/^order_toggle:/, async (ctx) => {
        const member = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!member || !hasManagerPermission(member) || !member.branchId) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.noPermissionShort') });
            return;
        }
        const productId = ctx.callbackQuery.data.split(':')[1];
        const products = await productService.getActiveProductsByBranch(member.branchId);
        const product = products.find(p => p._id.toString() === productId); // must belong to THIS branch
        if (!product) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'order.productNotFound') });
            return;
        }
        const draft = await orderService.getOrCreateDraft(member._id, member.branchId);
        const updated = await orderService.toggleItem(draft._id, product);
        const isSelected = updated.items.some(i => i.productId.toString() === productId);
        const view = productCardView(ctx.lang, product, isSelected);
        await ctx.editMessageReplyMarkup({ reply_markup: view.keyboard });
        await ctx.answerCallbackQuery();
    });

    // 4. "Send" opens the review: the chosen products, each removable, then Submit
    bot.callbackQuery('order_send', async (ctx) => {
        const member = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!member || !hasManagerPermission(member) || !member.branchId) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.noPermissionShort') });
            return;
        }
        const draft = await orderService.getOrCreateDraft(member._id, member.branchId);
        if (draft.items.length === 0) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'order.selectOne'), show_alert: true });
            return;
        }
        await ctx.answerCallbackQuery();
        await clearBasket(ctx); // the catalog cards would show stale selections
        const view = orderReviewView(ctx.lang, draft.items);
        const msg = await ctx.reply(view.text, { reply_markup: view.keyboard });
        ctx.session.basketMessageIds = [msg.message_id];
    });

    // 4a. Remove a product from the review
    bot.callbackQuery(/^order_rm:/, async (ctx) => {
        const member = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!member || !hasManagerPermission(member) || !member.branchId) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.noPermissionShort') });
            return;
        }
        const productId = ctx.callbackQuery.data.split(':')[1];
        let draft = await orderService.getOrCreateDraft(member._id, member.branchId);
        // only remove: a double tap must not add the product back
        if (draft.items.some(i => i.productId.toString() === productId)) {
            const product = (await productService.getActiveProductsByBranch(member.branchId)).find(p => p._id.toString() === productId);
            if (product) draft = await orderService.toggleItem(draft._id, product);
        }
        await ctx.answerCallbackQuery();
        const view = orderReviewView(ctx.lang, draft.items);
        await ctx.editMessageText(view.text, { reply_markup: view.keyboard }).catch(() => {});
    });

    // 4b. Submit: send to the group
    bot.callbackQuery('order_submit', async (ctx) => {
        const member = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!member || !hasManagerPermission(member) || !member.branchId) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.noPermissionShort') });
            return;
        }
        const branch = await branchService.getBranchById(member.branchId);
        if (!branch?.orderGroupId || !branch.threadIds?.order) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'order.noGroup'), show_alert: true });
            return;
        }
        const draft = await orderService.getOrCreateDraft(member._id, member.branchId);
        const orders = await orderService.submitDraft(draft._id);
        if (orders.length === 0) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'order.selectOne'), show_alert: true });
            return;
        }

        // one group message per product
        const failed: Order[] = [];
        for (const order of orders) {
            try {
                const products = await productService.getProductsByIds(order.items.map(i => i.productId));
                const view = orderMessageView(order, products, member.name);
                const sent = await ctx.api.sendMessage(branch.orderGroupId, view.text, {
                    message_thread_id: branch.threadIds.order,
                    reply_markup: view.keyboard,
                });
                await orderService.setGroupMessageId(order._id, sent.message_id);
            } catch (err) {
                console.error("send order to group failed:", err);
                failed.push(order);
            }
        }

        if (failed.length > 0) {
            await orderService.restoreToDraft(failed); // those products stay selected, manager can retry
            if (failed.length === orders.length) {
                await ctx.answerCallbackQuery({ text: t(ctx.lang, 'order.sendFailed'), show_alert: true });
                return;
            }
        }

        await clearBasket(ctx);
        await ctx.reply(t(ctx.lang, failed.length > 0 ? 'order.sendFailed' : 'order.sent'));
        await ctx.answerCallbackQuery();
    });

    // 5. Cancel the basket
    bot.callbackQuery('order_cancel', async (ctx) => {
        const member = await memberService.getMemberByTelegramId(ctx.from.id);
        if (member?.branchId) {
            await orderService.cancelDraftFor(member._id, member.branchId);
        }
        await clearBasket(ctx);
        await ctx.reply(t(ctx.lang, 'common.cancelled'));
        await ctx.answerCallbackQuery();
    });

    // 6. Boss/admin: ORDER -> ORDERED
    bot.callbackQuery(/^order_ordered:/, async (ctx) => {
        const member = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!member || !isBossOrAdmin(member)) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'order.onlyBoss'), show_alert: true });
            return;
        }
        const orderId = ctx.callbackQuery.data.split(':')[1];
        if (!Types.ObjectId.isValid(orderId)) {
            await ctx.answerCallbackQuery();
            return;
        }
        const order = await orderService.markOrdered(new Types.ObjectId(orderId), member._id);
        if (!order) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'order.alreadyChanged') });
            return;
        }
        const moved = await moveToTopic(ctx, order, 'ordered');
        if (!moved) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'order.moveFailed'), show_alert: true });
            return;
        }
        await ctx.answerCallbackQuery();
    });

    // 7. Manager of that branch: ORDERED -> ARRIVED
    bot.callbackQuery(/^order_received:/, async (ctx) => {
        const member = await memberService.getMemberByTelegramId(ctx.from.id);
        const current = await orderService.getById(ctx.callbackQuery.data.split(':')[1]);
        if (!member || !current || !isManagerOf(member, current.branchId.toString())) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'order.onlyBranchManager'), show_alert: true });
            return;
        }
        const order = await orderService.markArrived(current._id, member._id);
        if (!order) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'order.alreadyChanged') });
            return;
        }
        const moved = await moveToTopic(ctx, order, 'arrived');
        if (!moved) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'order.moveFailed'), show_alert: true });
            return;
        }
        await ctx.answerCallbackQuery();
    });

    // Telegram can't move a message between topics: send a new one, delete the old one.
    async function moveToTopic(ctx: MyContext, order: Order, topic: 'ordered' | 'arrived'): Promise<boolean> {
        const branch = await branchService.getBranchById(order.branchId);
        if (!branch?.orderGroupId || !branch.threadIds) {
            console.error(`moveToTopic: branch ${order.branchId} has no group connected`);
            return false;
        }
        try {
            const requester = await memberService.getMemberById(order.requestedBy);
            const products = await productService.getProductsByIds(order.items.map(i => i.productId));
            const view = orderMessageView(order, products, requester?.name ?? '—');
            const sent = await ctx.api.sendMessage(branch.orderGroupId, view.text, {
                message_thread_id: branch.threadIds[topic],
                reply_markup: view.keyboard,
            });
            if (order.groupMessageId) {
                await ctx.api.deleteMessage(branch.orderGroupId, order.groupMessageId).catch(() => {});
            }
            await orderService.setGroupMessageId(order._id, sent.message_id);
            return true;
        } catch (err) {
            console.error("moveToTopic failed:", err);
            return false;
        }
    }
}