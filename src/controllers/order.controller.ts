import { Bot } from 'grammy';
import { Types } from 'mongoose';
import { MyContext } from '../server';
import MemberService from '../models/Member.service';
import BranchService from '../models/Branch.service';
import ProductService from '../models/Product.service';
import OrderService from '../models/Order.service';
import { Order } from '../libs/types/order';
import { hasManagerPermission, isBossOrAdmin, isManagerOf } from '../libs/utils/permission';
import { orderPickerView, orderMessageView, storageMenuView } from '../views/index';

const memberService = new MemberService();
const branchService = new BranchService();
const productService = new ProductService();
const orderService = new OrderService();

export function orderController(bot: Bot<MyContext>) {

    // 1. Open the storage menu
    bot.hears("📦 Ombor", async (ctx) => {
        if (!ctx.from) return;
        const member = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!member || !hasManagerPermission(member)) {
            await ctx.reply("Sizda bu buyruq uchun ruxsat yo'q.");
            return;
        }
        const view = storageMenuView();
        await ctx.reply(view.text, { reply_markup: view.keyboard });
    });

    // 2. Open the basket
    bot.callbackQuery("order_start", async (ctx) => {
        await ctx.answerCallbackQuery();
        const member = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!member || !hasManagerPermission(member)) {
            await ctx.reply("Sizda bu buyruq uchun ruxsat yo'q.");
            return;
        }
        if (!member.branchId) {
            // boss/admin have no branch of their own
            await ctx.reply("Boss/admin uchun buyurtma berish keyingi bosqichda qo'shiladi.");
            return;
        }
        const products = await productService.getActiveProductsByBranch(member.branchId);
        if (products.length === 0) {
            await ctx.reply("Bu filialda hali mahsulotlar yo'q.");
            return;
        }
        const draft = await orderService.getOrCreateDraft(member._id, member.branchId);
        const selected = new Set(draft.items.map(i => i.productId.toString()));
        const view = orderPickerView(products, selected);
        await ctx.reply(view.text, { reply_markup: view.keyboard });
    });

    // 3. Toggle a product
    bot.callbackQuery(/^order_toggle:/, async (ctx) => {
        const member = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!member || !hasManagerPermission(member) || !member.branchId) {
            await ctx.answerCallbackQuery({ text: "Ruxsat yo'q." });
            return;
        }
        const productId = ctx.callbackQuery.data.split(':')[1];
        const products = await productService.getActiveProductsByBranch(member.branchId);
        const product = products.find(p => p._id.toString() === productId); // must belong to THIS branch
        if (!product) {
            await ctx.answerCallbackQuery({ text: "Mahsulot topilmadi." });
            return;
        }
        const draft = await orderService.getOrCreateDraft(member._id, member.branchId);
        const updated = await orderService.toggleItem(draft._id, product);
        const view = orderPickerView(products, new Set(updated.items.map(i => i.productId.toString())));
        await ctx.editMessageReplyMarkup({ reply_markup: view.keyboard });
        await ctx.answerCallbackQuery();
    });

    // 4. Send to the group
    bot.callbackQuery('order_send', async (ctx) => {
        const member = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!member || !hasManagerPermission(member) || !member.branchId) {
            await ctx.answerCallbackQuery({ text: "Ruxsat yo'q." });
            return;
        }
        const branch = await branchService.getBranchById(member.branchId);
        if (!branch?.orderGroupId || !branch.threadIds?.order) {
            await ctx.answerCallbackQuery({ text: "Filialga guruh ulanmagan.", show_alert: true });
            return;
        }
        const draft = await orderService.getOrCreateDraft(member._id, member.branchId);
        const order = await orderService.submitDraft(draft._id);
        if (!order) {
            await ctx.answerCallbackQuery({ text: "Kamida bitta mahsulotni belgilang.", show_alert: true });
            return;
        }

        const products = await productService.getProductsByIds(order.items.map(i => i.productId));
        const view = orderMessageView(order, products, member.name);

        let sent;
        try {
            sent = await ctx.api.sendMessage(branch.orderGroupId, view.text, {
                message_thread_id: branch.threadIds.order,
                reply_markup: view.keyboard,
            });
        } catch (err) {
            console.error("send order to group failed:", err);
            await orderService.revertToDraft(order._id); // selection survives, manager can retry
            await ctx.answerCallbackQuery({
                text: "Guruhga yuborib bo'lmadi. Keyinroq urinib ko'ring.",
                show_alert: true,
            });
            return;
        }

        await orderService.setGroupMessageId(order._id, sent.message_id);
        await ctx.editMessageText("✅ Buyurtma guruhga yuborildi.");
        await ctx.answerCallbackQuery();
    });

    // 5. Cancel the basket
    bot.callbackQuery('order_cancel', async (ctx) => {
        const member = await memberService.getMemberByTelegramId(ctx.from.id);
        if (member?.branchId) {
            await orderService.cancelDraftFor(member._id, member.branchId);
        }
        await ctx.editMessageText("Bekor qilindi.");
        await ctx.answerCallbackQuery();
    });

    // 6. Boss/admin: ORDER -> ORDERED
    bot.callbackQuery(/^order_ordered:/, async (ctx) => {
        const member = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!member || !isBossOrAdmin(member)) {
            await ctx.answerCallbackQuery({ text: "Faqat boss yoki admin.", show_alert: true });
            return;
        }
        const orderId = ctx.callbackQuery.data.split(':')[1];
        const order = await orderService.markOrdered(new Types.ObjectId(orderId), member._id);
        if (!order) {
            await ctx.answerCallbackQuery({ text: "Allaqachon o'zgartirilgan." });
            return;
        }
        const moved = await moveToTopic(ctx, order, 'ordered');
        if (!moved) {
            await ctx.answerCallbackQuery({ text: "Holat o'zgardi, lekin xabarni ko'chirib bo'lmadi.", show_alert: true });
            return;
        }
        await ctx.answerCallbackQuery();
    });

    // 7. Manager of that branch: ORDERED -> ARRIVED
    bot.callbackQuery(/^order_received:/, async (ctx) => {
        const member = await memberService.getMemberByTelegramId(ctx.from.id);
        const current = await orderService.getById(ctx.callbackQuery.data.split(':')[1]);
        if (!member || !current || !isManagerOf(member, current.branchId.toString())) {
            await ctx.answerCallbackQuery({ text: "Faqat shu filial menejeri.", show_alert: true });
            return;
        }
        const order = await orderService.markArrived(current._id, member._id);
        if (!order) {
            await ctx.answerCallbackQuery({ text: "Allaqachon o'zgartirilgan." });
            return;
        }
        const moved = await moveToTopic(ctx, order, 'arrived');
        if (!moved) {
            await ctx.answerCallbackQuery({ text: "Holat o'zgardi, lekin xabarni ko'chirib bo'lmadi.", show_alert: true });
            return;
        }
        await ctx.answerCallbackQuery();
    });

    // Telegram can't move a message between topics: send a new one, delete the old one.
    // Returns false if it could not be done, so the caller can tell the user.
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