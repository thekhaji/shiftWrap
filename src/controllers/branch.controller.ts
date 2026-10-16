import { Bot } from 'grammy';
import { MyContext } from '../server';
import BranchService from '../models/Branch.service';
import MemberService from '../models/Member.service';
import { askBranchNameView, askLocationView, branchRegisteredView, mainMenuView, managerBranchPickerView, managerCandidatePickerView } from '../views/index';
import Errors from '../libs/Errors';
import { MemberType } from '../libs/enums/member.enum';
import { isBossOrAdmin } from '../libs/utils/permission';
import { Types } from 'mongoose';

const branchService = new BranchService();
const memberService = new MemberService();

export function branchController(bot: Bot<MyContext>) {
    bot.hears("🏢 Filial qo'shish", async (ctx) => {
        if (!ctx.from) return;
        const actor = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!actor || !isBossOrAdmin(actor)) {
            await ctx.reply("Sizda bu buyruq uchun ruxsat yo'q.");
            return;
        }
        ctx.session.awaitingAction = "register_branch_name";
        ctx.session.awaitingSince = Date.now();
        const view = askBranchNameView();
        await ctx.reply(view.text, { reply_markup: view.keyboard });
    });

    bot.on("message:text", async (ctx, next) => {
        if (ctx.session.awaitingAction !== "register_branch_name") return next();

        const since = ctx.session.awaitingSince ?? 0;
        const expired = Date.now() - since > 60_000;

        ctx.session.awaitingAction = undefined;
        ctx.session.awaitingSince = undefined;

        if (expired) {
            await ctx.reply("Vaqt tugadi. Qaytadan urinib ko'ring.");
            return;
        }

        const name = ctx.message.text.trim();
        if (!name) {
            await ctx.reply("Filial nomi bo'sh bo'lishi mumkin emas. Qaytadan urinib ko'ring.");
            return;
        }

        ctx.session.pendingBranchName = name;
        ctx.session.awaitingAction = "register_branch_location";
        ctx.session.awaitingSince = Date.now();

        const view = askLocationView();
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
            await ctx.reply("Vaqt tugadi. Qaytadan urinib ko'ring.");
            return;
        }

        const { latitude, longitude } = ctx.message.location;

        try {
            const branch = await branchService.createBranch({ name, lat: latitude, lng: longitude });
            const view = branchRegisteredView(branch);
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
                await ctx.reply(err.message);
            } else {
                console.error("branch registration error:", err);
                await ctx.reply("Xatolik yuz berdi.");
            }
        }
    });

    // ---- appoint a branch manager (boss/admin only) ----

    bot.hears("👔 Filialga boshqaruvchi tayinlash", async (ctx) => {
        if (!ctx.from) return;
        const actor = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!actor || !isBossOrAdmin(actor)) {
            await ctx.reply("Sizda bu buyruq uchun ruxsat yo'q.");
            return;
        }
        const branches = await branchService.getAllBranches();
        if (branches.length === 0) {
            await ctx.reply("Hali filiallar qo'shilmagan.");
            return;
        }
        const view = managerBranchPickerView(branches);
        await ctx.reply(view.text, { reply_markup: view.keyboard });
    });

    bot.callbackQuery(/^mgr_branch:/, async (ctx) => {
        const actor = await memberService.getMemberByTelegramId(ctx.from.id);
        const branchId = ctx.callbackQuery.data.split(":")[1];
        if (!actor || !isBossOrAdmin(actor) || !Types.ObjectId.isValid(branchId)) {
            await ctx.answerCallbackQuery({ text: "Ruxsat yo'q." });
            return;
        }
        const branch = await branchService.getBranchById(new Types.ObjectId(branchId));
        if (!branch) {
            await ctx.answerCallbackQuery({ text: "Filial topilmadi." });
            return;
        }
        const candidates = (await memberService.getAllMembers())
            .filter(m => m.type === MemberType.USER || m.type === MemberType.MANAGER)
            .sort((a, b) => a.name.localeCompare(b.name));
        if (candidates.length === 0) {
            await ctx.answerCallbackQuery({ text: "Tayinlash uchun xodimlar topilmadi.", show_alert: true });
            return;
        }
        await ctx.answerCallbackQuery();
        const view = managerCandidatePickerView(branch, candidates);
        await ctx.editMessageText(view.text, { reply_markup: view.keyboard });
    });

    bot.callbackQuery(/^mgr_user:/, async (ctx) => {
        const actor = await memberService.getMemberByTelegramId(ctx.from.id);
        const [branchId, telegramId] = ctx.callbackQuery.data.split(":")[1].split(",");
        if (!actor || !isBossOrAdmin(actor) || !Types.ObjectId.isValid(branchId)) {
            await ctx.answerCallbackQuery({ text: "Ruxsat yo'q." });
            return;
        }
        const branch = await branchService.getBranchById(new Types.ObjectId(branchId));
        const target = await memberService.getMemberByTelegramId(Number(telegramId));
        if (!branch || !target || isBossOrAdmin(target)) {
            await ctx.answerCallbackQuery({ text: "Xodim yoki filial topilmadi.", show_alert: true });
            return;
        }
        const updated = await memberService.updateMember(target.telegramId, { type: MemberType.MANAGER, branchId: branch._id });
        await ctx.answerCallbackQuery();
        await ctx.editMessageText(`✅ ${updated.name} ${branch.name} filiali boshqaruvchisi etib tayinlandi.`);
    });
}
