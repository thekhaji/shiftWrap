import { Bot } from 'grammy';
import { MyContext } from '../server';
import BranchService from '../models/Branch.service';
import MemberService from '../models/Member.service';
import { askBranchNameView, askLocationView, branchRegisteredView, mainMenuView, managerBranchPickerView, managerCandidatePickerView } from '../views/index';
import Errors from '../libs/Errors';
import { MemberType } from '../libs/enums/member.enum';
import { isBossOrAdmin } from '../libs/utils/permission';
import { Types } from 'mongoose';
import { allLabels, errorText, t } from '../libs/i18n';

const branchService = new BranchService();
const memberService = new MemberService();

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
        const updated = await memberService.updateMember(target.telegramId, { type: MemberType.MANAGER, branchId: branch._id });
        await ctx.answerCallbackQuery();
        await ctx.editMessageText(t(ctx.lang, 'mgr.assigned', { name: updated.name, branch: branch.name }));
    });
}
