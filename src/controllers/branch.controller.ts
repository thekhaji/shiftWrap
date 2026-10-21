import { Bot } from 'grammy';
import { MyContext } from '../server';
import BranchService from '../models/Branch.service';
import MemberService from '../models/Member.service';
import ProductService from '../models/Product.service';
import { askBranchNameView, askLocationView, branchManagersView, branchProductAccessView, branchSettingsMenuView, settingsCandidatePickerView, branchRegisteredView, mainMenuView, managerBranchPickerView, managerCandidatePickerView, settingsBranchPickerView } from '../views/index';
import Errors, { Message } from '../libs/Errors';
import { MAX_MANAGERS_PER_BRANCH } from '../models/Member.service';
import { Branch } from '../libs/types/branch';
import { MemberType } from '../libs/enums/member.enum';
import { isAdmin, isBossOrAdmin } from '../libs/utils/permission';
import { Types } from 'mongoose';
import { allLabels, errorText, t } from '../libs/i18n';

const branchService = new BranchService();
const memberService = new MemberService();
const productService = new ProductService();

async function answerError(ctx: MyContext, err: unknown) {
    if (err instanceof Errors) {
        await ctx.answerCallbackQuery({ text: errorText(ctx.lang, err.message), show_alert: true });
    } else {
        console.error("branch settings error:", err);
        await ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.errorShort') });
    }
}

export function branchController(bot: Bot<MyContext>) {
    bot.hears(allLabels('menu.addBranch'), async (ctx) => {
        if (!ctx.from) return;
        const actor = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!actor || !isBossOrAdmin(actor)) {
            await ctx.reply(t(ctx.lang, 'common.noPermission'));
            return;
        }
        ctx.session.awaitingAction = "register_branch_name";
        ctx.session.awaitingSince = Date.now();
        const view = askBranchNameView(ctx.lang);
        await ctx.reply(view.text, { reply_markup: view.keyboard });
    });

    bot.on("message:text", async (ctx, next) => {
        if (ctx.session.awaitingAction !== "register_branch_name") return next();

        const since = ctx.session.awaitingSince ?? 0;
        const expired = Date.now() - since > 60_000;

        ctx.session.awaitingAction = undefined;
        ctx.session.awaitingSince = undefined;

        if (expired) {
            await ctx.reply(t(ctx.lang, 'common.timeout'));
            return;
        }

        const name = ctx.message.text.trim();
        if (!name) {
            await ctx.reply(t(ctx.lang, 'branch.nameEmpty'));
            return;
        }

        ctx.session.pendingBranchName = name;
        ctx.session.awaitingAction = "register_branch_location";
        ctx.session.awaitingSince = Date.now();

        const view = askLocationView(ctx.lang);
        await ctx.reply(view.text, { reply_markup: view.keyboard });
    });

    bot.on("message:location", async (ctx, next) => {
        if (ctx.session.awaitingAction !== "register_branch_location") return next();

        const since = ctx.session.awaitingSince ?? 0;
        const expired = Date.now() - since > 60_000;
        const name = ctx.session.pendingBranchName;

        ctx.session.awaitingAction = undefined;
        ctx.session.awaitingSince = undefined;
        ctx.session.pendingBranchName = undefined;

        if (expired || !name) {
            await ctx.reply(t(ctx.lang, 'common.timeout'));
            return;
        }

        const { latitude, longitude } = ctx.message.location;

        try {
            const branch = await branchService.createBranch({ name, lat: latitude, lng: longitude });
            const view = branchRegisteredView(ctx.lang, branch);
            await ctx.reply(view.text);

            if (ctx.from) {
                const member = await memberService.getMemberByTelegramId(ctx.from.id);
                if (member) {
                    const menu = mainMenuView(member);
                    await ctx.reply(menu.text, { reply_markup: menu.keyboard });
                }
            }
        } catch (err) {
            if (err instanceof Errors) {
                await ctx.reply(errorText(ctx.lang, err.message));
            } else {
                console.error("branch registration error:", err);
                await ctx.reply(t(ctx.lang, 'common.errorShort'));
            }
        }
    });

    // ---- appoint a branch manager (boss/admin only) ----

    bot.hears(allLabels('menu.assignManager'), async (ctx) => {
        if (!ctx.from) return;
        const actor = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!actor || !isBossOrAdmin(actor)) {
            await ctx.reply(t(ctx.lang, 'common.noPermission'));
            return;
        }
        const branches = await branchService.getAllBranches();
        if (branches.length === 0) {
            await ctx.reply(t(ctx.lang, 'branch.none'));
            return;
        }
        const view = managerBranchPickerView(ctx.lang, branches);
        await ctx.reply(view.text, { reply_markup: view.keyboard });
    });

    bot.callbackQuery(/^mgr_branch:/, async (ctx) => {
        const actor = await memberService.getMemberByTelegramId(ctx.from.id);
        const branchId = ctx.callbackQuery.data.split(":")[1];
        if (!actor || !isBossOrAdmin(actor) || !Types.ObjectId.isValid(branchId)) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.noPermissionShort') });
            return;
        }
        const branch = await branchService.getBranchById(new Types.ObjectId(branchId));
        if (!branch) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.branchNotFound') });
            return;
        }
        const candidates = (await memberService.getAllMembers())
            .filter(m => m.type === MemberType.USER || m.type === MemberType.MANAGER)
            .sort((a, b) => a.name.localeCompare(b.name));
        if (candidates.length === 0) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'mgr.noCandidates'), show_alert: true });
            return;
        }
        await ctx.answerCallbackQuery();
        const view = managerCandidatePickerView(ctx.lang, branch, candidates);
        await ctx.editMessageText(view.text, { reply_markup: view.keyboard });
    });

    bot.callbackQuery(/^mgr_user:/, async (ctx) => {
        const actor = await memberService.getMemberByTelegramId(ctx.from.id);
        const [branchId, telegramId] = ctx.callbackQuery.data.split(":")[1].split(",");
        if (!actor || !isBossOrAdmin(actor) || !Types.ObjectId.isValid(branchId)) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.noPermissionShort') });
            return;
        }
        const branch = await branchService.getBranchById(new Types.ObjectId(branchId));
        const target = await memberService.getMemberByTelegramId(Number(telegramId));
        if (!branch || !target || isBossOrAdmin(target)) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'mgr.notFound'), show_alert: true });
            return;
        }
        try {
            const updated = await memberService.assignManager(target.telegramId, branch._id);
            await ctx.answerCallbackQuery();
            await ctx.editMessageText(t(ctx.lang, 'mgr.assigned', { name: updated.name, branch: branch.name }));
        } catch (err) {
            await answerError(ctx, err);
        }
    });

    // ---- branch settings: which catalog products each branch storage can order (admin only) ----

    async function showAccess(ctx: MyContext, branchId: string, page: number) {
        if (!Types.ObjectId.isValid(branchId)) return;
        const branch = await branchService.getBranchById(new Types.ObjectId(branchId));
        if (!branch) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.branchNotFound') });
            return;
        }
        const products = await productService.getAllActiveProducts();
        if (products.length === 0) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'bs.noProducts'), show_alert: true });
            return;
        }
        await ctx.answerCallbackQuery();
        const view = branchProductAccessView(ctx.lang, branch, products, page);
        await ctx.editMessageText(view.text, { reply_markup: view.keyboard });
    }

    bot.hears(allLabels('menu.branchSettings'), async (ctx) => {
        if (!ctx.from) return;
        const actor = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!actor || !isAdmin(actor)) {
            await ctx.reply(t(ctx.lang, 'common.noPermission'));
            return;
        }
        const branches = await branchService.getAllBranches();
        if (branches.length === 0) {
            await ctx.reply(t(ctx.lang, 'branch.none'));
            return;
        }
        const view = settingsBranchPickerView(ctx.lang, branches);
        await ctx.reply(view.text, { reply_markup: view.keyboard });
    });

    // open a branch / change page
    bot.callbackQuery(/^bs_p:/, async (ctx) => {
        const actor = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!actor || !isAdmin(actor)) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.noPermissionShort') });
            return;
        }
        const [, branchId, page] = ctx.callbackQuery.data.split(":");
        await showAccess(ctx, branchId, Number(page) || 0);
    });

    // grant / revoke one product
    bot.callbackQuery(/^bs_t:/, async (ctx) => {
        const actor = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!actor || !isAdmin(actor)) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.noPermissionShort') });
            return;
        }
        const [, branchId, productId, page] = ctx.callbackQuery.data.split(":");
        if (!Types.ObjectId.isValid(branchId) || !Types.ObjectId.isValid(productId)) return;
        const branch = await branchService.getBranchById(new Types.ObjectId(branchId));
        if (!branch) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.branchNotFound') });
            return;
        }
        const has = (branch.productIds ?? []).some(id => id.toString() === productId);
        await branchService.setProductAccess(branch._id, new Types.ObjectId(productId), !has);
        await showAccess(ctx, branchId, Number(page) || 0);
    });

    bot.callbackQuery("bs_back", async (ctx) => {
        const actor = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!actor || !isAdmin(actor)) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.noPermissionShort') });
            return;
        }
        const branches = await branchService.getAllBranches();
        await ctx.answerCallbackQuery();
        const view = settingsBranchPickerView(ctx.lang, branches);
        await ctx.editMessageText(view.text, { reply_markup: view.keyboard });
    });

    // ---- managers (admin only, max 2 per branch) ----

    // admin check + branch lookup shared by the bs_* handlers below
    async function adminBranch(ctx: MyContext, branchId: string) {
        const actor = ctx.from ? await memberService.getMemberByTelegramId(ctx.from.id) : null;
        if (!actor || !isAdmin(actor) || !Types.ObjectId.isValid(branchId)) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.noPermissionShort') });
            return null;
        }
        const branch = await branchService.getBranchById(new Types.ObjectId(branchId));
        if (!branch) await ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.branchNotFound') });
        return branch;
    }

    async function showManagers(ctx: MyContext, branch: Branch) {
        const managers = await memberService.getManagersByBranch(branch._id);
        await ctx.answerCallbackQuery();
        const view = branchManagersView(ctx.lang, branch, managers);
        await ctx.editMessageText(view.text, { reply_markup: view.keyboard });
    }

    // branch settings menu
    bot.callbackQuery(/^bs_b:/, async (ctx) => {
        const branch = await adminBranch(ctx, ctx.callbackQuery.data.split(":")[1]);
        if (!branch) return;
        await ctx.answerCallbackQuery();
        const view = branchSettingsMenuView(ctx.lang, branch);
        await ctx.editMessageText(view.text, { reply_markup: view.keyboard });
    });

    bot.callbackQuery(/^bs_m:/, async (ctx) => {
        const branch = await adminBranch(ctx, ctx.callbackQuery.data.split(":")[1]);
        if (branch) await showManagers(ctx, branch);
    });

    // remove a manager
    bot.callbackQuery(/^bs_mr:/, async (ctx) => {
        const [, branchId, telegramId] = ctx.callbackQuery.data.split(":");
        const branch = await adminBranch(ctx, branchId);
        if (!branch) return;
        const target = await memberService.getMemberByTelegramId(Number(telegramId));
        // only someone who really manages THIS branch can be removed from it
        if (target && target.type === MemberType.MANAGER && target.branchId?.toString() === branchId) {
            try {
                await memberService.removeManager(target.telegramId);
            } catch (err) {
                await answerError(ctx, err);
                return;
            }
        }
        await showManagers(ctx, branch);
    });

    // pick who to assign
    bot.callbackQuery(/^bs_ma:/, async (ctx) => {
        const branch = await adminBranch(ctx, ctx.callbackQuery.data.split(":")[1]);
        if (!branch) return;
        const managers = await memberService.getManagersByBranch(branch._id);
        if (managers.length >= MAX_MANAGERS_PER_BRANCH) {
            await ctx.answerCallbackQuery({ text: errorText(ctx.lang, Message.MANAGER_LIMIT), show_alert: true });
            return;
        }
        const candidates = (await memberService.getAllMembers())
            .filter(m => m.type === MemberType.USER || (m.type === MemberType.MANAGER && m.branchId?.toString() !== branch._id.toString()))
            .sort((a, b) => a.name.localeCompare(b.name));
        if (candidates.length === 0) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'mgr.noCandidates'), show_alert: true });
            return;
        }
        await ctx.answerCallbackQuery();
        const view = settingsCandidatePickerView(ctx.lang, branch, candidates);
        await ctx.editMessageText(view.text, { reply_markup: view.keyboard });
    });

    bot.callbackQuery(/^bs_mu:/, async (ctx) => {
        const [, branchId, telegramId] = ctx.callbackQuery.data.split(":");
        const branch = await adminBranch(ctx, branchId);
        if (!branch) return;
        const target = await memberService.getMemberByTelegramId(Number(telegramId));
        if (!target || isBossOrAdmin(target)) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'mgr.notFound'), show_alert: true });
            return;
        }
        try {
            await memberService.assignManager(target.telegramId, branch._id);
        } catch (err) {
            await answerError(ctx, err);
            return;
        }
        await showManagers(ctx, branch);
    });

    bot.callbackQuery("bs_noop", (ctx) => ctx.answerCallbackQuery());
}
