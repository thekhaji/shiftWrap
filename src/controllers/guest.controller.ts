import { Bot } from 'grammy';
import { Types } from 'mongoose';
import { MyContext } from '../server';
import MemberService from '../models/Member.service';
import BranchService from '../models/Branch.service';
import ExpressService from '../models/Express.service';
import GuestService from '../models/Guest.service';
import InviteService from '../models/Invite.service';
import { Branch } from '../libs/types/branch';
import { ExpressProduct } from '../libs/types/express';
import { isAdmin } from '../libs/utils/permission';
import { allMenuLabels, Lang, t } from '../libs/i18n';
import Errors, { Message } from '../libs/Errors';
import {
    guestAccessView, guestCardView, guestConfirmView, guestListView, guestProductsView, guestSummaryView, typeName,
} from '../views/index';

const memberService = new MemberService();
const branchService = new BranchService();
const expressService = new ExpressService();
const guestService = new GuestService();
const inviteService = new InviteService();
const MENU_LABELS = allMenuLabels();

const oid = (text: string) => (Types.ObjectId.isValid(text) ? new Types.ObjectId(text) : null);

// The admin's "Guest restaurants": restaurants that are not our branches but order from the Express branches.
// Creating one gives a one-time link for its owner; the admin controls its access and products afterwards.
export function guestController(bot: Bot<MyContext>) {

    async function adminCallback(ctx: MyContext): Promise<boolean> {
        const actor = ctx.from ? await memberService.getMemberByTelegramId(ctx.from.id) : null;
        if (!actor || !isAdmin(actor)) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.noPermissionShort') });
            return false;
        }
        return true;
    }

    const edit = async (ctx: MyContext, view: { text: string; keyboard: any }) =>
        ctx.editMessageText(view.text, { reply_markup: view.keyboard }).catch(() => {});

    const supplierNames = (lang: Lang, expressBranches: Branch[]) => new Map(expressBranches.map(e => [e._id.toString(), typeName(lang, e.express!)]));

    // ---------- list ----------

    async function showList(ctx: MyContext, asNew = false) {
        const view = guestListView(ctx.lang, await guestService.getGuests(), await expressService.getExpressBranches());
        if (asNew) await ctx.reply(view.text, { reply_markup: view.keyboard });
        else await edit(ctx, view);
    }

    bot.callbackQuery('gr_noop', (ctx) => ctx.answerCallbackQuery());

    bot.callbackQuery('gr_l', async (ctx) => {
        if (!(await adminCallback(ctx))) return;
        await ctx.answerCallbackQuery();
        ctx.session.guestFlow = undefined;
        ctx.session.guestRename = undefined;
        await showList(ctx);
    });

    // ---------- creating a guest: name, Express branches, products, link ----------

    bot.callbackQuery('gr_add', async (ctx) => {
        if (!(await adminCallback(ctx))) return;
        if ((await expressService.getExpressBranches()).length === 0) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'xr.noExpress'), show_alert: true });
            return;
        }
        await ctx.answerCallbackQuery();
        ctx.session.guestRename = undefined;
        ctx.session.guestFlow = { step: 'name', supplierIds: [], productIds: [], page: 0 };
        await ctx.reply(t(ctx.lang, 'gr.askName'));
    });

    bot.callbackQuery('gr_cancel', async (ctx) => {
        ctx.session.guestFlow = undefined;
        await ctx.answerCallbackQuery();
        await ctx.deleteMessage().catch(() => {});
    });

    async function accessScreen(ctx: MyContext, asNew: boolean) {
        const flow = ctx.session.guestFlow!;
        const view = guestAccessView(ctx.lang, flow.name!, await expressService.getExpressBranches(), new Set(flow.supplierIds), {
            toggle: (id) => `gr_a:${id}`, done: 'gr_an', doneLabel: t(ctx.lang, 'gr.continue'), title: 'gr.pickAccess', cancel: 'gr_cancel',
        });
        if (asNew) await ctx.reply(view.text, { reply_markup: view.keyboard });
        else await edit(ctx, view);
    }

    // the products of the chosen Express branches, newest state of the tick list
    async function flowProducts(ctx: MyContext) {
        const flow = ctx.session.guestFlow!;
        return guestService.getProductsOf(flow.supplierIds.map(id => new Types.ObjectId(id)));
    }

    async function productsScreen(ctx: MyContext, asNew: boolean) {
        const flow = ctx.session.guestFlow!;
        const [products, expressBranches] = [await flowProducts(ctx), await expressService.getExpressBranches()];
        const view = guestProductsView(ctx.lang, flow.name!, products, supplierNames(ctx.lang, expressBranches), new Set(flow.productIds), flow.page, {
            toggle: (id) => `gr_p:${id}`, page: (n) => `gr_pg:${n}`, all: 'gr_pa', clear: 'gr_pc', done: 'gr_pn', doneLabel: t(ctx.lang, 'gr.continue'), back: 'gr_an_back',
        });
        if (asNew) await ctx.reply(view.text, { reply_markup: view.keyboard });
        else await edit(ctx, view);
    }

    bot.on('message:text', async (ctx, next) => {
        const flow = ctx.session.guestFlow;
        const rename = ctx.session.guestRename;
        if (!flow && !rename) return next();
        const text = ctx.message.text.trim();
        if (MENU_LABELS.has(text)) {
            ctx.session.guestFlow = undefined;
            ctx.session.guestRename = undefined;
            return next();
        }
        const actor = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!actor || !isAdmin(actor)) {
            ctx.session.guestFlow = undefined;
            ctx.session.guestRename = undefined;
            return next();
        }
        if (rename) {
            if (text.length < 1 || text.length > 60) {
                await ctx.reply(t(ctx.lang, 'gr.badName'));
                return;
            }
            const id = oid(rename.branchId);
            try {
                const updated = id ? await guestService.rename(id, text) : null;
                ctx.session.guestRename = undefined;
                if (updated) await ctx.reply(t(ctx.lang, 'gr.renamed'));
                if (updated) await showCard(ctx, updated._id, true);
            } catch (err) {
                await ctx.reply(t(ctx.lang, err instanceof Errors && err.message === Message.EXISTING_BRANCH ? 'gr.nameTaken' : 'common.errorShort'));
            }
            return;
        }
        if (flow!.step !== 'name') {
            await ctx.reply(t(ctx.lang, 'product.useButtons'));
            return;
        }
        if (text.length < 1 || text.length > 60) {
            await ctx.reply(t(ctx.lang, 'gr.badName'));
            return;
        }
        flow!.name = text;
        flow!.step = 'access';
        await accessScreen(ctx, true);
    });

    bot.callbackQuery(/^gr_a:/, async (ctx) => {
        const flow = ctx.session.guestFlow;
        if (!(await adminCallback(ctx))) return;
        if (!flow || flow.step !== 'access') return ctx.answerCallbackQuery({ text: t(ctx.lang, 'xo.expired') });
        const id = ctx.callbackQuery.data.split(':')[1];
        flow.supplierIds = flow.supplierIds.includes(id) ? flow.supplierIds.filter(s => s !== id) : [...flow.supplierIds, id];
        await ctx.answerCallbackQuery();
        await accessScreen(ctx, false);
    });

    bot.callbackQuery('gr_an', async (ctx) => {
        const flow = ctx.session.guestFlow;
        if (!(await adminCallback(ctx))) return;
        if (!flow || !flow.name) return ctx.answerCallbackQuery({ text: t(ctx.lang, 'xo.expired') });
        if (flow.supplierIds.length === 0) return ctx.answerCallbackQuery({ text: t(ctx.lang, 'gr.needAccess'), show_alert: true });
        flow.step = 'products';
        flow.page = 0;
        await ctx.answerCallbackQuery();
        await productsScreen(ctx, false);
    });

    bot.callbackQuery('gr_an_back', async (ctx) => {
        const flow = ctx.session.guestFlow;
        if (!(await adminCallback(ctx))) return;
        if (!flow || !flow.name) return ctx.answerCallbackQuery({ text: t(ctx.lang, 'xo.expired') });
        flow.step = 'access';
        await ctx.answerCallbackQuery();
        await accessScreen(ctx, false);
    });

    bot.callbackQuery(/^gr_p:/, async (ctx) => {
        const flow = ctx.session.guestFlow;
        if (!(await adminCallback(ctx))) return;
        if (!flow || flow.step !== 'products') return ctx.answerCallbackQuery({ text: t(ctx.lang, 'xo.expired') });
        const id = ctx.callbackQuery.data.split(':')[1];
        flow.productIds = flow.productIds.includes(id) ? flow.productIds.filter(p => p !== id) : [...flow.productIds, id];
        await ctx.answerCallbackQuery();
        await productsScreen(ctx, false);
    });

    bot.callbackQuery(/^gr_pg:/, async (ctx) => {
        const flow = ctx.session.guestFlow;
        if (!(await adminCallback(ctx))) return;
        if (!flow || flow.step !== 'products') return ctx.answerCallbackQuery({ text: t(ctx.lang, 'xo.expired') });
        flow.page = Number(ctx.callbackQuery.data.split(':')[1]) || 0;
        await ctx.answerCallbackQuery();
        await productsScreen(ctx, false);
    });

    bot.callbackQuery(/^gr_p[ac]$/, async (ctx) => {
        const flow = ctx.session.guestFlow;
        if (!(await adminCallback(ctx))) return;
        if (!flow || flow.step !== 'products') return ctx.answerCallbackQuery({ text: t(ctx.lang, 'xo.expired') });
        flow.productIds = ctx.callbackQuery.data === 'gr_pa' ? (await flowProducts(ctx)).map(p => p._id.toString()) : [];
        await ctx.answerCallbackQuery();
        await productsScreen(ctx, false);
    });

    bot.callbackQuery('gr_pn', async (ctx) => {
        const flow = ctx.session.guestFlow;
        if (!(await adminCallback(ctx))) return;
        if (!flow || flow.step !== 'products' || !flow.name) return ctx.answerCallbackQuery({ text: t(ctx.lang, 'xo.expired') });
        if (flow.productIds.length === 0) return ctx.answerCallbackQuery({ text: t(ctx.lang, 'gr.needProducts'), show_alert: true });
        flow.step = 'confirm';
        await ctx.answerCallbackQuery();
        const [products, expressBranches] = [await flowProducts(ctx), await expressService.getExpressBranches()];
        const express = expressBranches.filter(e => flow.supplierIds.includes(e._id.toString())).map(e => typeName(ctx.lang, e.express!)).join(' + ');
        const view = guestSummaryView(ctx.lang, flow.name, express, flow.productIds.length, products.length);
        await edit(ctx, view);
    });

    // one link for the owner of this restaurant
    async function sendLink(ctx: MyContext, actorId: Types.ObjectId, guest: Branch) {
        const token = await inviteService.createGuestInvite(actorId, guest._id);
        await ctx.reply(t(ctx.lang, 'gr.linkCreated', { name: guest.name, link: `https://t.me/${ctx.me.username}?start=guest_${token}` }));
    }

    bot.callbackQuery('gr_ok', async (ctx) => {
        const flow = ctx.session.guestFlow;
        const actor = ctx.from ? await memberService.getMemberByTelegramId(ctx.from.id) : null;
        if (!actor || !isAdmin(actor)) return ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.noPermissionShort') });
        if (!flow || flow.step !== 'confirm' || !flow.name) return ctx.answerCallbackQuery({ text: t(ctx.lang, 'xo.expired') });
        // only Express branches and products that still exist, and products that belong to the chosen branches
        const suppliers = (await expressService.getExpressBranches()).filter(e => flow.supplierIds.includes(e._id.toString()));
        const products = (await guestService.getProductsOf(suppliers.map(s => s._id))).filter(p => flow.productIds.includes(p._id.toString()));
        if (suppliers.length === 0 || products.length === 0) return ctx.answerCallbackQuery({ text: t(ctx.lang, 'xo.expired'), show_alert: true });
        ctx.session.guestFlow = undefined;   // a second tap finds nothing to create
        try {
            const guest = await guestService.createGuest(flow.name, suppliers.map(s => s._id), products.map(p => p._id));
            await ctx.answerCallbackQuery();
            await ctx.editMessageText(t(ctx.lang, 'gr.created', { name: guest.name })).catch(() => {});
            await sendLink(ctx, actor._id, guest);
        } catch (err) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, err instanceof Errors && err.message === Message.EXISTING_BRANCH ? 'gr.nameTaken' : 'common.errorShort'), show_alert: true });
        }
    });

    // ---------- one guest ----------

    async function showCard(ctx: MyContext, id: Types.ObjectId, asNew = false) {
        const guest = await guestService.getGuest(id);
        if (!guest) return showList(ctx, asNew);
        const expressBranches = await expressService.getExpressBranches();
        const owner = await guestService.getOwner(guest._id);
        const total = (await guestService.getProductsOf((guest.expressSupplierIds ?? []))).length;
        const view = guestCardView(ctx.lang, guest, owner, expressBranches, total);
        if (asNew) await ctx.reply(view.text, { reply_markup: view.keyboard });
        else await edit(ctx, view);
    }

    bot.callbackQuery(/^gr_c:/, async (ctx) => {
        if (!(await adminCallback(ctx))) return;
        const id = oid(ctx.callbackQuery.data.split(':')[1]);
        await ctx.answerCallbackQuery();
        ctx.session.guestRename = undefined;
        if (id) await showCard(ctx, id);
    });

    bot.callbackQuery(/^gr_rn:/, async (ctx) => {
        if (!(await adminCallback(ctx))) return;
        const id = ctx.callbackQuery.data.split(':')[1];
        if (!(await guestService.getGuest(id))) return ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.errorShort') });
        await ctx.answerCallbackQuery();
        ctx.session.guestFlow = undefined;
        ctx.session.guestRename = { branchId: id };
        await ctx.reply(t(ctx.lang, 'gr.askRename'));
    });

    // Express access of an existing guest
    async function showAccess(ctx: MyContext, guest: Branch) {
        const id = guest._id.toString();
        const view = guestAccessView(ctx.lang, guest.name, await expressService.getExpressBranches(), new Set((guest.expressSupplierIds ?? []).map(s => s.toString())), {
            toggle: (sid) => `gr_eat:${id}:${sid}`, done: `gr_c:${id}`, doneLabel: t(ctx.lang, 'bs.backShort'), title: 'gr.accessTitle', cancel: `gr_c:${id}`,
        });
        await edit(ctx, view);
    }

    bot.callbackQuery(/^gr_ea:/, async (ctx) => {
        if (!(await adminCallback(ctx))) return;
        const guest = await guestService.getGuest(ctx.callbackQuery.data.split(':')[1]);
        if (!guest) return ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.errorShort') });
        await ctx.answerCallbackQuery();
        await showAccess(ctx, guest);
    });

    bot.callbackQuery(/^gr_eat:/, async (ctx) => {
        if (!(await adminCallback(ctx))) return;
        const [, id, supplierId] = ctx.callbackQuery.data.split(':');
        const guestId = oid(id);
        const supplier = oid(supplierId);
        const updated = guestId && supplier ? await guestService.toggleSupplier(guestId, supplier) : null;
        if (!updated) return ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.errorShort') });
        await ctx.answerCallbackQuery();
        await showAccess(ctx, updated);
    });

    // products of an existing guest: over the products of the Express branches it may order from
    async function showProducts(ctx: MyContext, guest: Branch, page: number) {
        const id = guest._id.toString();
        const products = await guestService.getProductsOf(guest.expressSupplierIds ?? []);
        const view = guestProductsView(ctx.lang, guest.name, products, supplierNames(ctx.lang, await expressService.getExpressBranches()),
            new Set((guest.guestProductIds ?? []).map(p => p.toString())), page, {
                toggle: (pid) => `gr_ept:${id},${pid},${page}`, page: (n) => `gr_ep:${id},${n}`, all: `gr_epa:${id}`, clear: `gr_epc:${id}`,
                done: `gr_c:${id}`, doneLabel: t(ctx.lang, 'bs.backShort'), back: `gr_c:${id}`,
            });
        await edit(ctx, view);
    }

    bot.callbackQuery(/^gr_ep:/, async (ctx) => {
        if (!(await adminCallback(ctx))) return;
        const [id, page] = ctx.callbackQuery.data.split(':')[1].split(',');
        const guest = await guestService.getGuest(id);
        if (!guest) return ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.errorShort') });
        if (!guest.expressSupplierIds?.length) return ctx.answerCallbackQuery({ text: t(ctx.lang, 'gr.productsNoAccess'), show_alert: true });
        await ctx.answerCallbackQuery();
        await showProducts(ctx, guest, Number(page) || 0);
    });

    bot.callbackQuery(/^gr_ept:/, async (ctx) => {
        if (!(await adminCallback(ctx))) return;
        const [id, productId, page] = ctx.callbackQuery.data.split(':')[1].split(',');
        const guestId = oid(id);
        const product = oid(productId);
        const updated = guestId && product ? await guestService.toggleProduct(guestId, product) : null;
        if (!updated) return ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.errorShort') });
        await ctx.answerCallbackQuery();
        await showProducts(ctx, updated, Number(page) || 0);
    });

    bot.callbackQuery(/^gr_ep[ac]:/, async (ctx) => {
        if (!(await adminCallback(ctx))) return;
        const all = ctx.callbackQuery.data.startsWith('gr_epa:');
        const guest = await guestService.getGuest(ctx.callbackQuery.data.split(':')[1]);
        if (!guest) return ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.errorShort') });
        const products: ExpressProduct[] = all ? await guestService.getProductsOf(guest.expressSupplierIds ?? []) : [];
        const updated = await guestService.setProducts(guest._id, products.map(p => p._id));
        await ctx.answerCallbackQuery();
        if (updated) await showProducts(ctx, updated, 0);
    });

    // a link for an owner who has not joined, or a new owner
    bot.callbackQuery(/^gr_nl:/, async (ctx) => {
        const actor = ctx.from ? await memberService.getMemberByTelegramId(ctx.from.id) : null;
        if (!actor || !isAdmin(actor)) return ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.noPermissionShort') });
        const guest = await guestService.getGuest(ctx.callbackQuery.data.split(':')[1]);
        if (!guest || await guestService.getOwner(guest._id)) return ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.errorShort') });
        await ctx.answerCallbackQuery();
        await sendLink(ctx, actor._id, guest);
    });

    bot.callbackQuery(/^gr_co:/, async (ctx) => {
        if (!(await adminCallback(ctx))) return;
        const guest = await guestService.getGuest(ctx.callbackQuery.data.split(':')[1]);
        if (!guest) return ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.errorShort') });
        const owner = await guestService.getOwner(guest._id);
        await ctx.answerCallbackQuery();
        const id = guest._id.toString();
        await edit(ctx, guestConfirmView(ctx.lang, t(ctx.lang, 'gr.changeOwnerQ', { name: guest.name, owner: owner?.name ?? '—' }), t(ctx.lang, 'gr.confirmChange'), `gr_coy:${id}`, `gr_c:${id}`));
    });

    bot.callbackQuery(/^gr_coy:/, async (ctx) => {
        const actor = ctx.from ? await memberService.getMemberByTelegramId(ctx.from.id) : null;
        if (!actor || !isAdmin(actor)) return ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.noPermissionShort') });
        const guest = await guestService.getGuest(ctx.callbackQuery.data.split(':')[1]);
        if (!guest) return ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.errorShort') });
        await guestService.removeOwner(guest._id);
        await ctx.answerCallbackQuery();
        await showCard(ctx, guest._id);
        await sendLink(ctx, actor._id, guest);
    });

    // removing a guest
    bot.callbackQuery(/^gr_x:/, async (ctx) => {
        if (!(await adminCallback(ctx))) return;
        const guest = await guestService.getGuest(ctx.callbackQuery.data.split(':')[1]);
        if (!guest) return ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.errorShort') });
        await ctx.answerCallbackQuery();
        const id = guest._id.toString();
        await edit(ctx, guestConfirmView(ctx.lang, t(ctx.lang, 'gr.removeQ', { name: guest.name }), t(ctx.lang, 'gr.confirmRemove'), `gr_xy:${id}`, `gr_c:${id}`));
    });

    bot.callbackQuery(/^gr_xy:/, async (ctx) => {
        if (!(await adminCallback(ctx))) return;
        const id = oid(ctx.callbackQuery.data.split(':')[1]);
        const removed = id ? await guestService.remove(id) : null;
        if (!removed) return ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.errorShort') });
        await ctx.answerCallbackQuery({ text: t(ctx.lang, 'gr.removed', { name: removed.name }) });
        await showList(ctx);
    });
}
