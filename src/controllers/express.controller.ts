import { Api, Bot, InputFile } from 'grammy';
import { Types } from 'mongoose';
import { MyContext } from '../server';
import MemberService from '../models/Member.service';
import BranchService from '../models/Branch.service';
import ExpressService from '../models/Express.service';
import GroupService from '../models/Group.service';
import InviteService from '../models/Invite.service';
import { Branch } from '../libs/types/branch';
import { Member } from '../libs/types/member';
import { MemberType } from '../libs/enums/member.enum';
import { ExpressOrder, QtyItem } from '../libs/types/express';
import { ExpressOrderStatus, ExpressType } from '../libs/enums/express.enum';
import { allLabels, DEFAULT_LANG, Lang, monthNames, t } from '../libs/i18n';
import { hasManagerPermission, isAdmin, isBossOrAdmin, isManagerOf } from '../libs/utils/permission';
import { nowInSeoul } from '../libs/utils/time';
import { listText, MAX_QTY, money, orderTotal, sameQuantities, withQty } from '../libs/utils/expressMath';
import { buildExpressReceipt, branchLines } from '../libs/utils/expressReport';
import {
    expressAccessListView, expressAccessView, expressSupplierPickView, expressBranchView, expressDriversView, expressDriverView, expressGroupPickerView,
    expressSettingsView, expressTypePickerView, expressConfirmView, expressDateView, expressNoticeView, expressPickView, expressProductCardView,
    expressProductsView, expressQtyEditorView, expressReportBranchView, expressReportMonthView, expressReportTypeView,
    expressReviewView, expressStaffPickerView, expressTaskView, typeName,
} from '../views/express.views';

const memberService = new MemberService();
const branchService = new BranchService();
const expressService = new ExpressService();
const groupService = new GroupService();
const inviteService = new InviteService();

const CHECK_EVERY_MS = 10 * 60 * 1000;
const ASK_FROM_HOUR = 9;            // the next-day confirmation question goes out from 09:00 Seoul time
const MAX_PRICE = 100_000_000;

const oid = (text: string) => (Types.ObjectId.isValid(text) ? new Types.ObjectId(text) : null);
const isExpressType = (text: string): text is ExpressType => (Object.values(ExpressType) as string[]).includes(text);
const fullQuantities = (order: ExpressOrder): QtyItem[] => order.items.map(i => ({ productId: i.productId, qty: i.qty }));
const totalQty = (items: QtyItem[]) => items.reduce((sum, i) => sum + i.qty, 0);

// the manager and assistants of a branch; with none, bosses and admins
async function staffOf(branchId: Types.ObjectId): Promise<Member[]> {
    const managers = await memberService.getManagersByBranch(branchId);
    return managers.length ? managers : await memberService.getBossesAndAdmins();
}

// the order as the Express branch sees it, in the language of whoever reads it
async function noticeFor(lang: Lang, order: ExpressOrder) {
    const [branch, requester, responsible] = await Promise.all([
        branchService.getBranchById(order.orderBranchId),
        memberService.getMemberById(order.requestedBy),
        order.assignedTo ? memberService.getMemberById(order.assignedTo) : Promise.resolve(null),
    ]);
    return expressNoticeView(lang, order, { branch: branch?.name ?? '—', requester: requester?.name ?? '—', responsible: responsible?.name });
}

// the message an Express manager gets for one order
export async function sendExpressNotice(api: Api, member: Member, order: ExpressOrder): Promise<void> {
    const view = await noticeFor(member.language ?? DEFAULT_LANG, order);
    await api.sendMessage(member.telegramId, view.text, { reply_markup: view.keyboard })
        .catch((err) => console.error(`express notice to ${member.telegramId} failed:`, err));
}

// A new order reaches the Express branch group (managers tag who sends from there), and every driver
// of that branch gets it: "from <Express> to <branch>" with the products. With no group set,
// the managers get it in private instead.
async function deliverOrder(api: Api, supplier: Branch, order: ExpressOrder): Promise<void> {
    let inGroup = false;
    if (supplier.expressGroupId !== undefined) {
        const view = await noticeFor(DEFAULT_LANG, order);
        inGroup = await api.sendMessage(supplier.expressGroupId, view.text, { reply_markup: view.keyboard })
            .then(() => true)
            .catch((err) => { console.error(`express order to group ${supplier.expressGroupId} failed:`, err); return false; });
    }
    if (!inGroup) for (const m of await staffOf(supplier._id)) await sendExpressNotice(api, m, order);

    const ordering = await branchService.getBranchById(order.orderBranchId);
    for (const d of await memberService.getDrivers()) {
        const view = expressDriverView(d.language ?? DEFAULT_LANG, order, { from: supplier.name, to: ordering?.name ?? '—' });
        await api.sendMessage(d.telegramId, view.text)
            .catch((err) => console.error(`express order to driver ${d.telegramId} failed:`, err));
    }
}

async function notifyStaff(api: Api, branchId: Types.ObjectId, text: (lang: Lang) => string): Promise<void> {
    for (const m of await staffOf(branchId)) {
        await api.sendMessage(m.telegramId, text(m.language ?? DEFAULT_LANG))
            .catch((err) => console.error(`express message to ${m.telegramId} failed:`, err));
    }
}

// the next days an order can be needed on (Seoul calendar days, stored as midnight UTC)
function nextDays(count = 7): Date[] {
    const now = nowInSeoul();
    const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return Array.from({ length: count }, (_, i) => new Date(base + i * 86_400_000));
}
const dayKey = (d: Date) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;

export function expressController(bot: Bot<MyContext>) {

    // =============== admin: branch settings > Express ===============

    async function adminBranch(ctx: MyContext, branchId: string): Promise<Branch | null> {
        const actor = ctx.from ? await memberService.getMemberByTelegramId(ctx.from.id) : null;
        if (!actor || !isAdmin(actor) || !Types.ObjectId.isValid(branchId)) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.noPermissionShort') });
            return null;
        }
        const branch = await branchService.getBranchById(new Types.ObjectId(branchId));
        if (!branch) await ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.branchNotFound') });
        return branch;
    }

    const expressHolders = async () => {
        const held: Partial<Record<ExpressType, Branch>> = {};
        for (const b of await expressService.getExpressBranches()) held[b.express!] = b;
        return held;
    };

    async function showHome(ctx: MyContext, asNewMessage = false) {
        const view = expressSettingsView(ctx.lang, await expressHolders(), await memberService.getDrivers());
        if (asNewMessage) await ctx.reply(view.text, { reply_markup: view.keyboard });
        else await ctx.editMessageText(view.text, { reply_markup: view.keyboard }).catch(() => {});
    }

    // the screen of one Express branch: group, drivers, products
    async function showExpress(ctx: MyContext, branchId: Types.ObjectId) {
        const branch = await branchService.getBranchById(branchId);
        if (!branch?.express) return showHome(ctx);
        const group = branch.expressGroupId === undefined ? undefined : (await groupService.getTitles([branch.expressGroupId])).get(branch.expressGroupId) ?? `ID ${branch.expressGroupId}`;
        const view = expressBranchView(ctx.lang, branch, group);
        await ctx.editMessageText(view.text, { reply_markup: view.keyboard }).catch(() => {});
    }

    async function showAccessList(ctx: MyContext) {
        const expressBranches = await expressService.getExpressBranches();
        const view = expressAccessListView(ctx.lang, await expressService.getBranchesWithoutExpress(), expressBranches);
        await ctx.editMessageText(view.text, { reply_markup: view.keyboard }).catch(() => {});
    }

    async function showAccess(ctx: MyContext, branchId: Types.ObjectId) {
        const branch = await branchService.getBranchById(branchId);
        if (!branch || branch.express) return showAccessList(ctx);
        const view = expressAccessView(ctx.lang, branch, await expressService.getExpressBranches());
        await ctx.editMessageText(view.text, { reply_markup: view.keyboard }).catch(() => {});
    }

    async function adminOnly(ctx: MyContext): Promise<boolean> {
        const actor = ctx.from ? await memberService.getMemberByTelegramId(ctx.from.id) : null;
        if (!actor || !isAdmin(actor)) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.noPermissionShort') });
            return false;
        }
        return true;
    }

    bot.hears(allLabels('menu.expressSettings'), async (ctx) => {
        if (!ctx.from) return;
        const actor = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!actor || !isAdmin(actor)) {
            await ctx.reply(t(ctx.lang, 'common.noPermission'));
            return;
        }
        ctx.session.expressProduct = undefined;
        await showHome(ctx, true);
    });

    bot.callbackQuery('xs_home', async (ctx) => {
        if (!(await adminOnly(ctx))) return;
        await ctx.answerCallbackQuery();
        ctx.session.expressProduct = undefined;
        await showHome(ctx);
    });

    bot.callbackQuery(/^xs_pick:/, async (ctx) => {
        if (!(await adminOnly(ctx))) return;
        const type = ctx.callbackQuery.data.split(':')[1];
        if (!isExpressType(type)) return ctx.answerCallbackQuery();
        await ctx.answerCallbackQuery();
        const view = expressTypePickerView(ctx.lang, type, await expressService.getCandidates());
        await ctx.editMessageText(view.text, { reply_markup: view.keyboard }).catch(() => {});
    });

    bot.callbackQuery(/^xs_b:/, async (ctx) => {
        if (!(await adminOnly(ctx))) return;
        const id = oid(ctx.callbackQuery.data.split(':')[1]);
        await ctx.answerCallbackQuery();
        if (id) await showExpress(ctx, id);
    });

    bot.callbackQuery('xs_acc', async (ctx) => {
        if (!(await adminOnly(ctx))) return;
        await ctx.answerCallbackQuery();
        await showAccessList(ctx);
    });

    bot.callbackQuery(/^xs_ab:/, async (ctx) => {
        if (!(await adminOnly(ctx))) return;
        const id = oid(ctx.callbackQuery.data.split(':')[1]);
        await ctx.answerCallbackQuery();
        if (id) await showAccess(ctx, id);
    });

    // ---- the group that receives the orders of an Express branch ----

    async function showGroupPicker(ctx: MyContext, branchId: string, toast?: string) {
        const id = oid(branchId);
        const branch = id ? await branchService.getBranchById(id) : null;
        if (!branch?.express) {
            await ctx.answerCallbackQuery();
            return;
        }
        await ctx.answerCallbackQuery(toast ? { text: toast } : undefined);
        const used = new Set<number>();   // a group serves one branch in one role
        for (const b of await branchService.getAllBranches()) {
            for (const g of [b.orderGroupId, b.cleaningGroupId, b.expressGroupId]) if (g !== undefined) used.add(g);
        }
        const current = branch.expressGroupId === undefined ? undefined : (await groupService.getTitles([branch.expressGroupId])).get(branch.expressGroupId) ?? `ID ${branch.expressGroupId}`;
        const groups = (await groupService.getAdminGroups(ctx.api, ctx.me.id, false)).filter(g => !used.has(g.chatId));
        const view = expressGroupPickerView(ctx.lang, branch, current, groups);
        await ctx.editMessageText(view.text, { reply_markup: view.keyboard }).catch(() => {});
    }

    bot.callbackQuery(/^xs_g:/, async (ctx) => {
        if (!(await adminOnly(ctx))) return;
        await showGroupPicker(ctx, ctx.callbackQuery.data.split(':')[1]);
    });

    bot.callbackQuery(/^xs_gr:/, async (ctx) => {
        if (!(await adminOnly(ctx))) return;
        const branchId = ctx.callbackQuery.data.split(':')[1];
        const id = oid(branchId);
        if (!id) return ctx.answerCallbackQuery();
        await expressService.setGroup(id, null);
        await showGroupPicker(ctx, branchId, t(ctx.lang, 'bs.groupRemoved'));
    });

    bot.callbackQuery(/^xs_gs:/, async (ctx) => {
        if (!(await adminOnly(ctx))) return;
        const [, branchId, chatIdText] = ctx.callbackQuery.data.split(':');
        const id = oid(branchId);
        const chatId = Number(chatIdText);
        if (!id || !Number.isInteger(chatId)) return ctx.answerCallbackQuery();
        // the picker may be showing an old list: the bot must still be admin there and nobody else may use it
        const used = (await branchService.getAllBranches()).some(b => [b.orderGroupId, b.cleaningGroupId, b.expressGroupId].includes(chatId));
        if (used || !(await groupService.getAdminGroups(ctx.api, ctx.me.id, false)).some(g => g.chatId === chatId)) {
            await showGroupPicker(ctx, branchId);
            return;
        }
        if (!(await expressService.setGroup(id, chatId))) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.errorShort'), show_alert: true });
            return;
        }
        await showGroupPicker(ctx, branchId, t(ctx.lang, 'bs.groupAssigned'));
    });

    // ---- drivers: invited like a boss; the same drivers receive the orders of every Express branch ----

    bot.callbackQuery('xs_inv', async (ctx) => {
        const actor = ctx.from ? await memberService.getMemberByTelegramId(ctx.from.id) : null;
        if (!actor || !isAdmin(actor)) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.noPermissionShort') });
            return;
        }
        await ctx.answerCallbackQuery();
        const token = await inviteService.createDriverInvite(actor._id);
        await ctx.reply(t(ctx.lang, 'xs.inviteCreated', { link: `https://t.me/${ctx.me.username}?start=driver_${token}` }));
    });

    bot.callbackQuery('xs_d', async (ctx) => {
        if (!(await adminOnly(ctx))) return;
        await ctx.answerCallbackQuery();
        const view = expressDriversView(ctx.lang, await memberService.getDrivers());
        await ctx.editMessageText(view.text, { reply_markup: view.keyboard }).catch(() => {});
    });

    bot.callbackQuery(/^xs_dr:/, async (ctx) => {
        if (!(await adminOnly(ctx))) return;
        const id = oid(ctx.callbackQuery.data.split(':')[1]);
        const driver = id ? await memberService.getMemberById(id) : null;
        if (!id || !driver || driver.type !== MemberType.DRIVER || !(await memberService.removeDriver(id))) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.errorShort') });
            return;
        }
        await ctx.answerCallbackQuery({ text: t(ctx.lang, 'xs.driverRemoved', { name: driver.name }) });
        const mine = await memberService.getDrivers();
        if (mine.length === 0) return showHome(ctx);
        const view = expressDriversView(ctx.lang, mine);
        await ctx.editMessageText(view.text, { reply_markup: view.keyboard }).catch(() => {});
    });

    // bx_e: the screen of an Express branch (the products screen goes back here)
    bot.callbackQuery(/^bx_e:/, async (ctx) => {
        const branch = await adminBranch(ctx, ctx.callbackQuery.data.split(':')[1]);
        if (!branch) return;
        await ctx.answerCallbackQuery();
        ctx.session.expressProduct = undefined;
        await showExpress(ctx, branch._id);
    });

    // make the branch Taksim Express, Troy Express, or neither
    bot.callbackQuery(/^bx_t:/, async (ctx) => {
        const [, branchId, type] = ctx.callbackQuery.data.split(':');
        const branch = await adminBranch(ctx, branchId);
        if (!branch) return;
        let toast: string;
        if (type === 'NONE') {
            if (!(await expressService.clearType(branch._id))) {
                await ctx.answerCallbackQuery({ text: t(ctx.lang, 'bx.hasAccess'), show_alert: true });
                return;
            }
            toast = t(ctx.lang, 'bx.typeCleared', { branch: branch.name });
        } else if (isExpressType(type)) {
            const result = await expressService.setType(branch._id, type);
            if (!result.ok) {
                await ctx.answerCallbackQuery({ text: t(ctx.lang, 'bx.takenBy', { type: typeName(ctx.lang, type), branch: result.takenBy.name }), show_alert: true });
                return;
            }
            toast = t(ctx.lang, 'bx.typeSet', { branch: branch.name, type: typeName(ctx.lang, type) });
        } else {
            await ctx.answerCallbackQuery();
            return;
        }
        await ctx.answerCallbackQuery({ text: toast });
        await showExpress(ctx, branch._id);   // falls back to the home screen once it is no longer Express
    });

    // switch one Express branch on or off for a branch: it may order from both
    bot.callbackQuery(/^bx_s:/, async (ctx) => {
        const [, branchId, supplierId] = ctx.callbackQuery.data.split(':');
        const branch = await adminBranch(ctx, branchId);
        const supplier = oid(supplierId);
        if (!branch || !supplier) {
            if (branch) await ctx.answerCallbackQuery();
            return;
        }
        const had = !!branch.expressSupplierIds?.some(s => s.equals(supplier));
        if (!(await expressService.setSupplier(branch._id, supplier, !had))) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.errorShort'), show_alert: true });
            return;
        }
        const holder = (await expressService.getExpressBranches()).find(b => b._id.equals(supplier));
        const type = holder?.express ? typeName(ctx.lang, holder.express) : '';
        await ctx.answerCallbackQuery({ text: had ? t(ctx.lang, 'bx.accessRemoved') : t(ctx.lang, 'bx.accessSet', { branch: branch.name, type }) });
        await showAccess(ctx, branch._id);
    });

    // ---- the products an Express branch sells, with prices ----

    async function showProducts(ctx: MyContext, branch: Branch, asNewMessage = false) {
        const view = expressProductsView(ctx.lang, branch, await expressService.getProducts(branch._id));
        if (asNewMessage) await ctx.reply(view.text, { reply_markup: view.keyboard });
        else await ctx.editMessageText(view.text, { reply_markup: view.keyboard }).catch(() => {});
    }

    bot.callbackQuery(/^bx_p:/, async (ctx) => {
        const branch = await adminBranch(ctx, ctx.callbackQuery.data.split(':')[1]);
        if (!branch || !branch.express) return;
        await ctx.answerCallbackQuery();
        ctx.session.expressProduct = undefined;
        await showProducts(ctx, branch);
    });

    bot.callbackQuery(/^bx_pa:/, async (ctx) => {
        const branch = await adminBranch(ctx, ctx.callbackQuery.data.split(':')[1]);
        if (!branch || !branch.express) return;
        await ctx.answerCallbackQuery();
        ctx.session.expressProduct = { branchId: branch._id.toString(), step: 'name' };
        await ctx.reply(t(ctx.lang, 'xp.askName'));
    });

    bot.callbackQuery(/^bx_pe:/, async (ctx) => {
        const [branchId, productId] = ctx.callbackQuery.data.split(':')[1].split(',');
        if (!(await adminBranch(ctx, branchId))) return;
        const product = await expressService.getProduct(productId);
        if (!product || product.expressBranchId.toString() !== branchId) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.errorShort') });
            return;
        }
        await ctx.answerCallbackQuery();
        const view = expressProductCardView(ctx.lang, product);
        await ctx.editMessageText(view.text, { reply_markup: view.keyboard }).catch(() => {});
    });

    bot.callbackQuery(/^bx_pp:/, async (ctx) => {
        const product = await expressService.getProduct(ctx.callbackQuery.data.split(':')[1]);
        if (!product || !(await adminBranch(ctx, product.expressBranchId.toString()))) return;
        await ctx.answerCallbackQuery();
        ctx.session.expressProduct = { branchId: product.expressBranchId.toString(), step: 'price', productId: product._id.toString() };
        await ctx.reply(t(ctx.lang, 'xp.askPrice'));
    });

    bot.callbackQuery(/^bx_pd:/, async (ctx) => {
        const product = await expressService.getProduct(ctx.callbackQuery.data.split(':')[1]);
        const branch = product ? await adminBranch(ctx, product.expressBranchId.toString()) : null;
        if (!product || !branch) return;
        await expressService.deleteProduct(product._id.toString());
        await ctx.answerCallbackQuery({ text: t(ctx.lang, 'xp.deleted') });
        await showProducts(ctx, branch);
    });

    // the admin types a product name, then its price
    bot.on('message:text', async (ctx, next) => {
        const flow = ctx.session.expressProduct;
        if (!flow) return next();
        const actor = await memberService.getMemberByTelegramId(ctx.from.id);
        const branch = actor && isAdmin(actor) ? await branchService.getBranchById(new Types.ObjectId(flow.branchId)) : null;
        if (!branch || !branch.express) {
            ctx.session.expressProduct = undefined;
            return next();
        }
        const text = ctx.message.text.trim();

        if (flow.step === 'name') {
            if (!text) {
                await ctx.reply(t(ctx.lang, 'xp.askName'));
                return;
            }
            ctx.session.expressProduct = { ...flow, step: 'price', name: text.slice(0, 60) };
            await ctx.reply(t(ctx.lang, 'xp.askPrice'));
            return;
        }

        const price = Number(text.replace(/[\s,]/g, ''));
        if (!Number.isInteger(price) || price < 1 || price > MAX_PRICE) {
            await ctx.reply(t(ctx.lang, 'xp.badPrice'));
            return;
        }
        if (flow.productId) {
            await expressService.updatePrice(flow.productId, price);
            ctx.session.expressProduct = undefined;
            await ctx.reply(t(ctx.lang, 'xp.updated'));
            await showProducts(ctx, branch, true);
            return;
        }
        const created = flow.name ? await expressService.createProduct(branch._id, flow.name, price) : null;
        if (!created) {
            ctx.session.expressProduct = { branchId: flow.branchId, step: 'name' };
            await ctx.reply(t(ctx.lang, 'xp.exists'));
            await ctx.reply(t(ctx.lang, 'xp.askName'));
            return;
        }
        ctx.session.expressProduct = undefined;
        await ctx.reply(t(ctx.lang, 'xp.added', { name: created.name, price: money(price) }));
        await showProducts(ctx, branch, true);
    });

    // =============== ordering: manager or assistant of a branch with Express access ===============

    async function orderState(ctx: MyContext) {
        const expired = async () => {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'xo.expired'), show_alert: true });
            return null;
        };
        const member = ctx.from ? await memberService.getMemberByTelegramId(ctx.from.id) : null;
        const st = ctx.session.expressOrder;
        if (!member || !hasManagerPermission(member) || !member.branchId || !st) return expired();
        const branch = await branchService.getBranchById(member.branchId);
        const supplier = branch ? (await expressService.getSuppliersOf(branch)).find(sp => sp._id.toString() === st.supplierId) : undefined;
        if (!branch || !supplier?.express) return expired();
        return { member, branch, supplier, products: await expressService.getProducts(supplier._id), st };
    }

    const pickView = (ctx: MyContext, s: NonNullable<Awaited<ReturnType<typeof orderState>>>, page: number) =>
        expressPickView(ctx.lang, s.supplier.name, s.products, s.st.qty, page);

    // the first screen of an order from the chosen Express branch
    async function startOrder(ctx: MyContext, supplier: Branch) {
        const products = await expressService.getProducts(supplier._id);
        if (products.length === 0) {
            await ctx.reply(t(ctx.lang, 'xo.noProducts'));
            return;
        }
        ctx.session.expressOrder = { supplierId: supplier._id.toString(), qty: {} };
        const view = expressPickView(ctx.lang, supplier.name, products, {}, 0);
        await ctx.reply(view.text, { reply_markup: view.keyboard });
    }

    bot.hears(allLabels('menu.expressOrder'), async (ctx) => {
        if (!ctx.from) return;
        const member = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!member || !hasManagerPermission(member) || !member.branchId) {
            await ctx.reply(t(ctx.lang, 'common.noPermission'));
            return;
        }
        const branch = await branchService.getBranchById(member.branchId);
        const suppliers = branch ? await expressService.getSuppliersOf(branch) : [];
        if (suppliers.length === 0) {
            await ctx.reply(t(ctx.lang, 'xo.noAccess'));
            return;
        }
        ctx.session.expressOrder = undefined;
        if (suppliers.length === 1) {
            await startOrder(ctx, suppliers[0]);
            return;
        }
        // access to both Express branches: choose where to order from
        const view = expressSupplierPickView(ctx.lang, suppliers);
        await ctx.reply(view.text, { reply_markup: view.keyboard });
    });

    bot.callbackQuery(/^xo_s:/, async (ctx) => {
        const member = ctx.from ? await memberService.getMemberByTelegramId(ctx.from.id) : null;
        const branch = member && hasManagerPermission(member) && member.branchId ? await branchService.getBranchById(member.branchId) : null;
        const supplier = branch ? (await expressService.getSuppliersOf(branch)).find(sp => sp._id.toString() === ctx.callbackQuery.data.split(':')[1]) : undefined;
        if (!supplier) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'xo.expired'), show_alert: true });
            return;
        }
        await ctx.answerCallbackQuery();
        await ctx.deleteMessage().catch(() => {});
        await startOrder(ctx, supplier);
    });

    bot.callbackQuery('xo_i', (ctx) => ctx.answerCallbackQuery());

    bot.callbackQuery(/^xo_q:/, async (ctx) => {
        const s = await orderState(ctx);
        if (!s) return;
        const [productId, direction, page] = ctx.callbackQuery.data.split(':')[1].split(',');
        if (!s.products.some(p => p._id.toString() === productId)) {
            await ctx.answerCallbackQuery();
            return;
        }
        const next = (s.st.qty[productId] ?? 0) + (direction === 'p' ? 1 : -1);
        s.st.qty[productId] = Math.min(MAX_QTY, Math.max(0, next));
        await ctx.answerCallbackQuery();
        const view = pickView(ctx, s, Number(page) || 0);
        await ctx.editMessageText(view.text, { reply_markup: view.keyboard }).catch(() => {});
    });

    bot.callbackQuery(/^xo_pg:/, async (ctx) => {
        const s = await orderState(ctx);
        if (!s) return;
        s.st.date = undefined;
        await ctx.answerCallbackQuery();
        const view = pickView(ctx, s, Number(ctx.callbackQuery.data.split(':')[1]) || 0);
        await ctx.editMessageText(view.text, { reply_markup: view.keyboard }).catch(() => {});
    });

    bot.callbackQuery('xo_next', async (ctx) => {
        const s = await orderState(ctx);
        if (!s) return;
        if (!s.products.some(p => (s.st.qty[p._id.toString()] ?? 0) > 0)) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'xo.selectOne'), show_alert: true });
            return;
        }
        await ctx.answerCallbackQuery();
        const view = expressDateView(ctx.lang, nextDays());
        await ctx.editMessageText(view.text, { reply_markup: view.keyboard }).catch(() => {});
    });

    bot.callbackQuery(/^xo_d:/, async (ctx) => {
        const s = await orderState(ctx);
        if (!s) return;
        const key = ctx.callbackQuery.data.split(':')[1];
        const day = nextDays().find(d => dayKey(d) === key);   // only the days that were offered
        const lines = s.products.map(p => ({ name: p.name, price: p.price, qty: s.st.qty[p._id.toString()] ?? 0 })).filter(l => l.qty > 0);
        if (!day || lines.length === 0) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'xo.expired'), show_alert: true });
            return;
        }
        s.st.date = key;
        await ctx.answerCallbackQuery();
        const view = expressReviewView(ctx.lang, s.supplier.name, day, lines);
        await ctx.editMessageText(view.text, { reply_markup: view.keyboard }).catch(() => {});
    });

    bot.callbackQuery('xo_submit', async (ctx) => {
        const s = await orderState(ctx);
        if (!s) return;
        const day = nextDays().find(d => dayKey(d) === s.st.date);
        // prices are read now, so the order is charged at the price in force when it is sent
        const items = s.products
            .filter(p => (s.st.qty[p._id.toString()] ?? 0) > 0)
            .map(p => ({ productId: p._id, name: p.name, price: p.price, qty: s.st.qty[p._id.toString()] }));
        if (!day || items.length === 0) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'xo.expired'), show_alert: true });
            return;
        }
        ctx.session.expressOrder = undefined; // a second tap finds nothing to submit
        const order = await expressService.createOrder({
            orderBranchId: s.branch._id, supplierBranchId: s.supplier._id, requestedBy: s.member._id, neededDate: day, items,
        });
        await ctx.answerCallbackQuery();
        await ctx.editMessageText(t(ctx.lang, 'xo.sent', { supplier: s.supplier.name })).catch(() => {});
        await deliverOrder(ctx.api, s.supplier, order);
    });

    bot.callbackQuery('xo_cancel', async (ctx) => {
        ctx.session.expressOrder = undefined;
        await ctx.answerCallbackQuery();
        await ctx.deleteMessage().catch(() => {});
    });

    // =============== the Express branch: tag who sends, they send ===============

    const isSupplierStaff = (m: Member, order: ExpressOrder) => isBossOrAdmin(m) || isManagerOf(m, order.supplierBranchId.toString());
    const isOrderingStaff = (m: Member, order: ExpressOrder) => isManagerOf(m, order.orderBranchId.toString());

    async function loadOrder(ctx: MyContext, id: string) {
        const member = ctx.from ? await memberService.getMemberByTelegramId(ctx.from.id) : null;
        const order = await expressService.getOrder(id);
        if (!member || !order) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'xe.alreadyDone'), show_alert: true });
            return null;
        }
        return { member, order };
    }

    bot.callbackQuery(/^xe_tag:/, async (ctx) => {
        const loaded = await loadOrder(ctx, ctx.callbackQuery.data.split(':')[1]);
        if (!loaded) return;
        const { member, order } = loaded;
        if (!isSupplierStaff(member, order)) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.noPermissionShort') });
            return;
        }
        if (order.status !== ExpressOrderStatus.NEW && order.status !== ExpressOrderStatus.ASSIGNED) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'xe.alreadyDone'), show_alert: true });
            return;
        }
        const staff = await memberService.getActiveMembersByBranch(order.supplierBranchId);
        if (staff.length === 0) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'xe.noStaff'), show_alert: true });
            return;
        }
        await ctx.answerCallbackQuery();
        const view = expressStaffPickerView(ctx.lang, order, staff);
        await ctx.reply(view.text, { reply_markup: view.keyboard });
    });

    bot.callbackQuery(/^xe_who:/, async (ctx) => {
        const [orderId, memberId] = ctx.callbackQuery.data.split(':')[1].split(',');
        const loaded = await loadOrder(ctx, orderId);
        if (!loaded) return;
        const { member, order } = loaded;
        const staff = await memberService.getActiveMembersByBranch(order.supplierBranchId);
        const assignee = staff.find(m => m._id.toString() === memberId);
        if (!isSupplierStaff(member, order) || !assignee) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.noPermissionShort') });
            return;
        }
        const assigned = await expressService.assign(order._id, assignee._id);
        if (!assigned) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'xe.alreadyDone'), show_alert: true });
            return;
        }
        await ctx.answerCallbackQuery();
        await ctx.editMessageText(t(ctx.lang, 'xe.tagged', { name: assignee.name })).catch(() => {});
        const branch = await branchService.getBranchById(assigned.orderBranchId);
        const view = expressTaskView(assignee.language ?? DEFAULT_LANG, assigned, branch?.name ?? '—');
        await ctx.api.sendMessage(assignee.telegramId, view.text, { reply_markup: view.keyboard })
            .catch((err) => console.error(`express task to ${assignee.telegramId} failed:`, err));
    });

    // sent: remember it, tell the Express managers; the ordering branch is asked the next day
    async function finishSending(ctx: MyContext, member: Member, order: ExpressOrder, quantities: QtyItem[]) {
        const sent = await expressService.markSent(order._id, member._id, quantities);
        if (!sent) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'xe.alreadyDone'), show_alert: true });
            return;
        }
        await ctx.answerCallbackQuery();
        const branch = await branchService.getBranchById(sent.orderBranchId);
        const branchName = branch?.name ?? '—';
        await ctx.editMessageText(t(ctx.lang, 'xe.markedSent', { branch: branchName })).catch(() => {});
        await notifyStaff(ctx.api, sent.supplierBranchId, (lang) => t(lang, 'xe.sentNotice', { name: member.name, branch: branchName }));
    }

    bot.callbackQuery(/^xe_full:/, async (ctx) => {
        const loaded = await loadOrder(ctx, ctx.callbackQuery.data.split(':')[1]);
        if (!loaded) return;
        if (!loaded.order.assignedTo?.equals(loaded.member._id)) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'xe.notYours'), show_alert: true });
            return;
        }
        await finishSending(ctx, loaded.member, loaded.order, fullQuantities(loaded.order));
    });

    bot.callbackQuery(/^xe_chg:/, async (ctx) => {
        const loaded = await loadOrder(ctx, ctx.callbackQuery.data.split(':')[1]);
        if (!loaded) return;
        const { member, order } = loaded;
        if (!order.assignedTo?.equals(member._id)) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'xe.notYours'), show_alert: true });
            return;
        }
        const drafted = await expressService.startDraft(order._id, ExpressOrderStatus.ASSIGNED, fullQuantities(order));
        if (!drafted) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'xe.alreadyDone'), show_alert: true });
            return;
        }
        await ctx.answerCallbackQuery();
        const branch = await branchService.getBranchById(drafted.orderBranchId);
        const view = expressQtyEditorView(ctx.lang, drafted, drafted.draft ?? [], 'send', branch?.name ?? '—');
        await ctx.editMessageText(view.text, { reply_markup: view.keyboard }).catch(() => {});
    });

    // one editor for both stages: who may use it depends on the order's status
    bot.callbackQuery(/^xq:/, async (ctx) => {
        const [orderId, productId, direction] = ctx.callbackQuery.data.split(':')[1].split(',');
        const loaded = await loadOrder(ctx, orderId);
        const product = oid(productId);
        if (!loaded || !product) return;
        const { member, order } = loaded;
        const sending = order.status === ExpressOrderStatus.ASSIGNED;
        const receiving = order.status === ExpressOrderStatus.SENT;
        if ((!sending && !receiving) || !order.draft) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'xe.alreadyDone'), show_alert: true });
            return;
        }
        if ((sending && !order.assignedTo?.equals(member._id)) || (receiving && !isOrderingStaff(member, order))) {
            await ctx.answerCallbackQuery({ text: sending ? t(ctx.lang, 'xe.notYours') : t(ctx.lang, 'common.noPermissionShort'), show_alert: true });
            return;
        }
        const updated = await expressService.adjustDraft(order._id, product, direction === 'p' ? 1 : -1);
        if (!updated) return;
        await ctx.answerCallbackQuery();
        const branch = await branchService.getBranchById(sending ? updated.orderBranchId : updated.supplierBranchId);
        const view = expressQtyEditorView(ctx.lang, updated, updated.draft ?? [], sending ? 'send' : 'receive', branch?.name ?? '—');
        await ctx.editMessageText(view.text, { reply_markup: view.keyboard }).catch(() => {});
    });

    bot.callbackQuery(/^xdone:/, async (ctx) => {
        const loaded = await loadOrder(ctx, ctx.callbackQuery.data.split(':')[1]);
        if (!loaded) return;
        const { member, order } = loaded;
        const draft = order.draft ?? [];
        if (order.status === ExpressOrderStatus.ASSIGNED) {
            if (!order.assignedTo?.equals(member._id)) {
                await ctx.answerCallbackQuery({ text: t(ctx.lang, 'xe.notYours'), show_alert: true });
                return;
            }
            if (totalQty(draft) === 0) {
                await ctx.answerCallbackQuery({ text: t(ctx.lang, 'xe.nothing'), show_alert: true });
                return;
            }
            await finishSending(ctx, member, order, draft);
            return;
        }
        if (order.status === ExpressOrderStatus.SENT && isOrderingStaff(member, order)) {
            await finishConfirming(ctx, member, order, draft);
            return;
        }
        await ctx.answerCallbackQuery({ text: t(ctx.lang, 'xe.alreadyDone'), show_alert: true });
    });

    // =============== the next day: did the ordering branch receive what was sent? ===============

    async function finishConfirming(ctx: MyContext, member: Member, order: ExpressOrder, received: QtyItem[]) {
        const done = await expressService.markReceived(order._id, member._id, received);
        if (!done) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'xe.alreadyDone'), show_alert: true });
            return;
        }
        await ctx.answerCallbackQuery();
        const items = withQty(done.items, done.receivedItems);
        const total = money(orderTotal(items));
        await ctx.editMessageText(t(ctx.lang, 'xc.done', { total })).catch(() => {});

        // the Express branch hears about it, and about any difference from what they sent
        const branch = await branchService.getBranchById(done.orderBranchId);
        const same = sameQuantities(done.sentItems ?? [], done.receivedItems ?? []);
        const recipients = new Map((await staffOf(done.supplierBranchId)).map(m => [m._id.toString(), m]));
        const sender = done.assignedTo ? await memberService.getMemberById(done.assignedTo) : null;
        if (sender) recipients.set(sender._id.toString(), sender);
        for (const r of recipients.values()) {
            const lang = r.language ?? DEFAULT_LANG;
            const text = same
                ? t(lang, 'xc.confirmedNotice', { branch: branch?.name ?? '—', total })
                : t(lang, 'xc.differsNotice', { branch: branch?.name ?? '—', list: listText(items), total });
            await ctx.api.sendMessage(r.telegramId, text).catch((err) => console.error(`express confirmation to ${r.telegramId} failed:`, err));
        }
    }

    bot.callbackQuery(/^xc_ok:/, async (ctx) => {
        const loaded = await loadOrder(ctx, ctx.callbackQuery.data.split(':')[1]);
        if (!loaded) return;
        const { member, order } = loaded;
        if (!isOrderingStaff(member, order) || order.status !== ExpressOrderStatus.SENT) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, order.status === ExpressOrderStatus.RECEIVED ? 'xe.alreadyDone' : 'common.noPermissionShort'), show_alert: true });
            return;
        }
        await finishConfirming(ctx, member, order, order.sentItems ?? []);
    });

    bot.callbackQuery(/^xc_chg:/, async (ctx) => {
        const loaded = await loadOrder(ctx, ctx.callbackQuery.data.split(':')[1]);
        if (!loaded) return;
        const { member, order } = loaded;
        if (!isOrderingStaff(member, order) || order.status !== ExpressOrderStatus.SENT) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, order.status === ExpressOrderStatus.RECEIVED ? 'xe.alreadyDone' : 'common.noPermissionShort'), show_alert: true });
            return;
        }
        const drafted = await expressService.startDraft(order._id, ExpressOrderStatus.SENT, order.sentItems ?? []);
        if (!drafted) return;
        await ctx.answerCallbackQuery();
        const supplier = await branchService.getBranchById(drafted.supplierBranchId);
        const view = expressQtyEditorView(ctx.lang, drafted, drafted.draft ?? [], 'receive', supplier?.name ?? '—');
        await ctx.editMessageText(view.text, { reply_markup: view.keyboard }).catch(() => {});
    });

    // =============== admin: the receipt of each branch, one month at a time ===============

    // the report is for bosses and admins
    async function reportActor(ctx: MyContext): Promise<Member | null> {
        const actor = ctx.from ? await memberService.getMemberByTelegramId(ctx.from.id) : null;
        if (!actor || !isBossOrAdmin(actor)) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.noPermissionShort') });
            return null;
        }
        return actor;
    }

    // the boss panel (and the admin's boss view) open the report from the menu
    bot.hears(allLabels('menu.expressReport'), async (ctx) => {
        if (!ctx.from) return;
        const actor = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!actor || !isBossOrAdmin(actor)) {
            await ctx.reply(t(ctx.lang, 'common.noPermission'));
            return;
        }
        const express = await expressService.getExpressBranches();
        if (express.length === 0) {
            await ctx.reply(t(ctx.lang, 'xr.noExpress'));
            return;
        }
        const view = expressReportTypeView(ctx.lang, express, false);
        await ctx.reply(view.text, { reply_markup: view.keyboard });
    });

    bot.callbackQuery('xs_rep', async (ctx) => {
        if (!(await reportActor(ctx))) return;
        const express = await expressService.getExpressBranches();
        if (express.length === 0) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'xr.noExpress'), show_alert: true });
            return;
        }
        await ctx.answerCallbackQuery();
        const view = expressReportTypeView(ctx.lang, express, true);
        await ctx.editMessageText(view.text, { reply_markup: view.keyboard }).catch(() => {});
    });

    // back from the branch list to the Express branches
    bot.callbackQuery('xr_back', async (ctx) => {
        const actor = await reportActor(ctx);
        if (!actor) return;
        const express = await expressService.getExpressBranches();
        await ctx.answerCallbackQuery();
        const view = expressReportTypeView(ctx.lang, express, isAdmin(actor));
        await ctx.editMessageText(view.text, { reply_markup: view.keyboard }).catch(() => {});
    });

    bot.callbackQuery(/^xr_e:/, async (ctx) => {
        if (!(await reportActor(ctx))) return;
        const type = ctx.callbackQuery.data.split(':')[1];
        const supplier = isExpressType(type) ? await expressService.getBranchByType(type) : null;
        if (!supplier || !isExpressType(type)) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'xr.noExpress'), show_alert: true });
            return;
        }
        const branches = await expressService.getOrderingBranches(supplier._id);
        if (branches.length === 0) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'xr.noBranches'), show_alert: true });
            return;
        }
        await ctx.answerCallbackQuery();
        const view = expressReportBranchView(ctx.lang, type, branches);
        await ctx.editMessageText(view.text, { reply_markup: view.keyboard }).catch(() => {});
    });

    bot.callbackQuery(/^xr_b:/, async (ctx) => {
        if (!(await reportActor(ctx))) return;
        const [type, scope] = ctx.callbackQuery.data.split(':')[1].split(',');
        const supplier = isExpressType(type) ? await expressService.getBranchByType(type) : null;
        if (!supplier || !isExpressType(type) || (scope !== 'ALL' && !Types.ObjectId.isValid(scope))) {
            await ctx.answerCallbackQuery();
            return;
        }
        const months = await expressService.getReceivedMonths(supplier._id, scope === 'ALL' ? undefined : new Types.ObjectId(scope));
        if (months.length === 0) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'xr.empty'), show_alert: true });
            return;
        }
        await ctx.answerCallbackQuery();
        const view = expressReportMonthView(ctx.lang, type, scope, months, monthNames(ctx.lang));
        await ctx.editMessageText(view.text, { reply_markup: view.keyboard }).catch(() => {});
    });

    bot.callbackQuery(/^xr_m:/, async (ctx) => {
        if (!(await reportActor(ctx))) return;
        const [type, scope, which] = ctx.callbackQuery.data.split(':')[1].split(',');
        const supplier = isExpressType(type) ? await expressService.getBranchByType(type) : null;
        const picked = /^(\d{4})-(\d{2})$/.exec(which ?? '');
        if (!supplier || !isExpressType(type) || !picked || (scope !== 'ALL' && !Types.ObjectId.isValid(scope))) {
            await ctx.answerCallbackQuery();
            return;
        }
        const year = Number(picked[1]);
        const month = Number(picked[2]);

        const branches = scope === 'ALL'
            ? await expressService.getOrderingBranches(supplier._id)
            : [await branchService.getBranchById(new Types.ObjectId(scope))].filter((b): b is Branch => !!b);
        const receipts = [];
        for (const b of branches) {
            receipts.push({ name: b.name, orders: await expressService.getReceivedInMonth(supplier._id, year, month, b._id) });
        }
        if (receipts.every(r => branchLines(r.orders).length === 0)) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'xr.empty'), show_alert: true });
            return;
        }
        await ctx.answerCallbackQuery();
        const typeLabel = typeName(ctx.lang, type);
        const { buffer, total } = await buildExpressReceipt({ express: typeLabel, year, month, branches: receipts });
        const scopeName = scope === 'ALL' ? t(ctx.lang, 'xr.allBranches').replace(/^\S+\s/, '') : receipts[0]?.name ?? '';
        await ctx.replyWithDocument(new InputFile(buffer, `${type}_${scopeName.replace(/[^\p{L}\p{N}]+/gu, '_')}_${year}-${String(month).padStart(2, '0')}.xlsx`), {
            caption: t(ctx.lang, 'xr.caption', { type: typeLabel, scope: scopeName, month: monthNames(ctx.lang)[month - 1], year, total: money(total) }),
        });
    });
}

// Sent on an earlier day and not yet asked: from 09:00 the ordering branch is asked whether the sent quantities arrived.
export function startExpressConfirmations(bot: Bot<MyContext>) {
    async function run() {
        try {
            if (nowInSeoul().getUTCHours() < ASK_FROM_HOUR) return;
            for (const order of await expressService.getDueForConfirmation()) {
                if (!(await expressService.claimAsk(order._id))) continue; // another run got there first
                const supplier = await branchService.getBranchById(order.supplierBranchId);
                const sender = order.assignedTo ? await memberService.getMemberById(order.assignedTo) : null;
                for (const m of await staffOf(order.orderBranchId)) {
                    const view = expressConfirmView(m.language ?? DEFAULT_LANG, order, { supplier: supplier?.name ?? '—', sender: sender?.name ?? '—' });
                    await bot.api.sendMessage(m.telegramId, view.text, { reply_markup: view.keyboard })
                        .catch((err) => console.error(`express confirmation request to ${m.telegramId} failed:`, err));
                }
            }
        } catch (err) {
            console.error('express confirmation run failed:', err);
        }
    }
    run();
    setInterval(run, CHECK_EVERY_MS).unref();
}
