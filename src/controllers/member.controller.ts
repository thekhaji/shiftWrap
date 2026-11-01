import { Bot } from "grammy";
import { MyContext } from "../server";
import MemberService from "../models/Member.service";
import BranchService from "../models/Branch.service";
import { adminTelegramIds } from "../libs/utils/config";
import InviteService from "../models/Invite.service";
import { askBranch, sendPendingState } from "./registration.controller";
import { Types } from "mongoose";
import { MemberStatus, MemberType } from "../libs/enums/member.enum";
import { askPhoneView, mainMenuView, errorView, userEditView, userPickerView, askEditFieldDetailView, languagePickerView, employeeBranchPickerView, branchMovePickerView } from "../views/index";
import { allLabels, errorText, t } from "../libs/i18n";
import Errors, { Message } from "../libs/Errors";
import { Member, MemberInput, MemberManagerUpdate, EditableMemberField, EDITABLE_MEMBER_FIELDS } from "../libs/types/member";
import { hasManagerPermission, hasSalaryAccess, isAdmin, isBossOrAdmin } from "../libs/utils/permission";

const memberService = new MemberService();
const branchService = new BranchService();
const inviteService = new InviteService();

const MAX_NAME_LENGTH = 100;

function isEditableField(field: string): field is EditableMemberField {
    return (EDITABLE_MEMBER_FIELDS as readonly string[]).includes(field);
}

function canManageEmployees(member: Member): boolean {
    return hasManagerPermission(member) || isBossOrAdmin(member);
}

// bosses and admins edit anyone; a manager or assistant only people of their own branch
function canEditMember(actor: Member, target: Member): boolean {
    if (isBossOrAdmin(actor)) return true;
    return !!actor.branchId && target.branchId?.toString() === actor.branchId.toString();
}

export function memberController(bot: Bot<MyContext>) {
    bot.command("start", async (ctx) => {
        if (!ctx.from) return; // nobody to reply to — silent exit is honest

        const member = await memberService.getMemberByTelegramId(ctx.from.id);

        // t.me/<bot>?start=boss_<token>
        const token = ctx.match.startsWith('boss_') ? ctx.match.slice('boss_'.length) : undefined;
        if (token) {
            if (!(await inviteService.isValid(token))) {
                await ctx.reply(t(ctx.lang, 'invite.invalid'));
                if (!member) return;
            } else if (!member) {
                ctx.session.bossInvite = token; // used when the phone number arrives
            } else if (!isBossOrAdmin(member) && await inviteService.consume(token, ctx.from.id)) {
                const boss = await memberService.promoteToBoss(member.telegramId);
                const view = mainMenuView(boss);
                await ctx.reply(`${t(boss.language ?? ctx.lang, 'invite.promoted')}\n${view.text}`, { reply_markup: view.keyboard });
                return;
            }
        }

        if (member) {
            if (member.status === MemberStatus.PENDING && member.type === MemberType.USER) {
                await sendPendingState(ctx, member);
                return;
            }
            const view = mainMenuView(member);
            await ctx.reply(view.text, { reply_markup: view.keyboard });
        } else if (ctx.session.lang) {
            const view = askPhoneView(ctx.session.lang);
            await ctx.reply(view.text, { reply_markup: view.keyboard });
        } else {
            // new user: language first, then the phone number
            const view = languagePickerView('reg_lang');
            await ctx.reply(view.text, { reply_markup: view.keyboard });
        }
    });

    bot.on("message:contact", async (ctx) => {
        if (!ctx.from) return;

        // Reject contact cards forwarded from someone else — only self-shared numbers are valid.
        if (ctx.message.contact.user_id !== ctx.from.id) {
            await ctx.reply(t(ctx.lang, 'reg.ownNumber'));
            return;
        }

        // Already registered — just show the menu instead of trying to re-register.
        const existing = await memberService.getMemberByTelegramId(ctx.from.id);
        if (existing) {
            const view = mainMenuView(existing);
            await ctx.reply(view.text, { reply_markup: view.keyboard });
            return;
        }

        // an invited boss is trusted; everyone else waits for their branch manager
        const inviteToken = ctx.session.bossInvite;
        ctx.session.bossInvite = undefined;
        if (inviteToken && !(await inviteService.consume(inviteToken, ctx.from.id))) {
            await ctx.reply(t(ctx.lang, 'invite.invalid'));
            return;
        }

        const configuredAdmin = adminTelegramIds().includes(ctx.from.id);
        const memberInput: MemberInput = {
            telegramId: ctx.from.id,
            name: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" "),
            username: ctx.from.username,
            phone: ctx.message.contact.phone_number,
            language: ctx.session.lang ?? ctx.lang,
            type: configuredAdmin ? MemberType.ADMIN : inviteToken ? MemberType.BOSS : MemberType.USER,
            status: configuredAdmin || inviteToken ? MemberStatus.ACTIVE : MemberStatus.PENDING,
        };

        // createMember throws rather than returning a failure value, so this needs try/catch.
        try {
            const result = await memberService.createMember(memberInput);
            if (result.status === MemberStatus.PENDING) {
                await askBranch(ctx);
                return;
            }
            const view = mainMenuView(result);
            await ctx.reply(view.text, { reply_markup: view.keyboard });
        } catch (err) {
            if (inviteToken) await inviteService.release(inviteToken); // the link was not used up
            // double-tap race: "already exists" is success from the user's view
            if (err instanceof Errors && err.message === Message.EXISTING_USER) {
                const existingMember = await memberService.getMemberByTelegramId(memberInput.telegramId);
                if (existingMember) {
                    const view = mainMenuView(existingMember);
                    await ctx.reply(view.text, { reply_markup: view.keyboard });
                }
                return;
            }
            console.error("registration failed:", err);
            await ctx.reply(errorView(ctx.lang).text);
        }
    });

    bot.hears(allLabels('menu.employees'), async (ctx) => {
        if (!ctx.from) return;

        const actor = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!actor || !canManageEmployees(actor)) {
            await ctx.reply(t(ctx.lang, 'common.noPermission'));
            return;
        }

        if (isBossOrAdmin(actor)) {
            // no branch of their own: first choose whose employees to look at
            const branches = await branchService.getAllBranches();
            if (branches.length === 0) {
                await ctx.reply(t(ctx.lang, 'branch.none'));
                return;
            }
            const branchView = employeeBranchPickerView(ctx.lang, branches);
            await ctx.reply(branchView.text, { reply_markup: branchView.keyboard });
            return;
        }

        const users = await memberService.getActiveMembersByBranch(actor.branchId!);
        const view = userPickerView(ctx.lang, users);
        await ctx.reply(view.text, { reply_markup: view.keyboard });
    });

    // admin/boss: the employees of the chosen branch
    bot.callbackQuery(/^emp_branch:/, async (ctx) => {
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
        const users = await memberService.getActiveMembersByBranch(branch._id);
        if (users.length === 0) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'emp.noneInBranch'), show_alert: true });
            return;
        }
        await ctx.answerCallbackQuery();
        const view = userPickerView(ctx.lang, users);
        await ctx.reply(`${branch.name}\n${view.text}`, { reply_markup: view.keyboard });
    });

    bot.callbackQuery(/^user_picker:/, async (ctx) => {
        await ctx.answerCallbackQuery();
        if (!ctx.from) return;

        const actor = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!actor || !canManageEmployees(actor)) {
            await ctx.reply(t(ctx.lang, 'common.noPermission'));
            return;
        }

        const userTgId = ctx.callbackQuery.data.split(":")[1];
        const member = await memberService.getMemberByTelegramId(Number(userTgId));
        if (!member || !canEditMember(actor, member)) return;

        const branch = member.branchId ? await branchService.getBranchById(member.branchId) : undefined;
        const view = await userEditView(ctx.lang, member, branch?.name || null, hasSalaryAccess(actor), isAdmin(actor));
        await ctx.reply(view.text, { reply_markup: view.keyboard });
    });

    bot.callbackQuery(/^edit_user:/, async (ctx) => {
        await ctx.answerCallbackQuery();
        if (!ctx.from) return;

        const actor = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!actor || !canManageEmployees(actor)) {
            await ctx.reply(t(ctx.lang, 'common.noPermission'));
            return;
        }

        const [telegramId, field] = ctx.callbackQuery.data.split(":")[1].split(",");
        if (!isEditableField(field)) return;
        // the branch assistant may change names and phone numbers only, never pay or bank details
        if (field !== "phone" && field !== "name" && !hasSalaryAccess(actor)) {
            await ctx.reply(t(ctx.lang, 'common.noPermission'));
            return;
        }

        const member = await memberService.getMemberByTelegramId(Number(telegramId));
        if (!member || !canEditMember(actor, member)) return;

        // Remember who/what we're waiting on so the message:text handler below
        // knows how to interpret the manager's next message.
        ctx.session.awaitingAction = "edit_member_field";
        ctx.session.awaitingSince = Date.now();
        ctx.session.editingMemberTelegramId = member.telegramId;
        ctx.session.editingField = field;

        const view = askEditFieldDetailView(ctx.lang, member.name, field);
        await ctx.reply(view.text, { reply_markup: view.keyboard });
    });

    // admin: pick a new branch for an employee
    bot.callbackQuery(/^emp_mv:/, async (ctx) => {
        const actor = await memberService.getMemberByTelegramId(ctx.from.id);
        const target = await memberService.getMemberByTelegramId(Number(ctx.callbackQuery.data.split(":")[1]));
        if (!actor || !isAdmin(actor) || !target || isBossOrAdmin(target)) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.noPermissionShort') });
            return;
        }
        if (target.type === MemberType.MANAGER) {
            // a manager's seat belongs to the old branch: it has to be removed there first
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'emp.isManager', { name: target.name }), show_alert: true });
            return;
        }
        const branches = (await branchService.getAllBranches()).filter(b => b._id.toString() !== target.branchId?.toString());
        if (branches.length === 0) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'branch.none'), show_alert: true });
            return;
        }
        const current = target.branchId ? await branchService.getBranchById(target.branchId) : undefined;
        await ctx.answerCallbackQuery();
        const view = branchMovePickerView(ctx.lang, target, branches, current?.name || t(ctx.lang, 'common.unknown'));
        await ctx.reply(view.text, { reply_markup: view.keyboard });
    });

    bot.callbackQuery(/^emp_mvb:/, async (ctx) => {
        const actor = await memberService.getMemberByTelegramId(ctx.from.id);
        const [telegramId, branchId] = ctx.callbackQuery.data.split(":")[1].split(",");
        const target = await memberService.getMemberByTelegramId(Number(telegramId));
        // callback data is client-controlled: re-check everything
        if (!actor || !isAdmin(actor) || !target || isBossOrAdmin(target) || !Types.ObjectId.isValid(branchId)) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.noPermissionShort') });
            return;
        }
        if (target.type === MemberType.MANAGER) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'emp.isManager', { name: target.name }), show_alert: true });
            return;
        }
        const branch = await branchService.getBranchById(new Types.ObjectId(branchId));
        if (!branch) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.branchNotFound') });
            return;
        }
        await memberService.updateMember(target.telegramId, { branchId: branch._id });
        await ctx.answerCallbackQuery();
        await ctx.editMessageText(t(ctx.lang, 'emp.branchChanged', { name: target.name, branch: branch.name })).catch(() => {});
    });

    bot.on("message:text", async (ctx, next) => {
        if (ctx.session.awaitingAction !== "edit_member_field") return next();

        const since = ctx.session.awaitingSince ?? 0;
        const expired = Date.now() - since > 60_000;
        const targetTelegramId = ctx.session.editingMemberTelegramId;
        const field = ctx.session.editingField;

        ctx.session.awaitingAction = undefined;
        ctx.session.awaitingSince = undefined;
        ctx.session.editingMemberTelegramId = undefined;
        ctx.session.editingField = undefined;

        if (expired || !targetTelegramId || !field) {
            await ctx.reply(t(ctx.lang, 'common.timeout'));
            return;
        }

        const rawValue = ctx.message.text.trim();
        if (!rawValue) {
            await ctx.reply(t(ctx.lang, 'emp.valueEmpty'));
            return;
        }

        if (field === "name" && rawValue.length > MAX_NAME_LENGTH) {
            await ctx.reply(t(ctx.lang, 'emp.nameTooLong', { max: MAX_NAME_LENGTH }));
            return;
        }

        const updateData: MemberManagerUpdate = {};
        if (field === "hourlyRate") {
            const parsed = Number(rawValue);
            if (Number.isNaN(parsed)) {
                await ctx.reply(t(ctx.lang, 'emp.numberOnly'));
                return;
            }
            updateData.hourlyRate = parsed;
        } else {
            updateData[field] = rawValue;
        }

        try {
            const updated = await memberService.updateMember(targetTelegramId, updateData);
            await ctx.reply(t(ctx.lang, 'emp.updated'));
            const branch = updated.branchId ? await branchService.getBranchById(updated.branchId) : undefined;
            const editor = ctx.from ? await memberService.getMemberByTelegramId(ctx.from.id) : null;
            const view = await userEditView(ctx.lang, updated, branch?.name || null, !!editor && hasSalaryAccess(editor), !!editor && isAdmin(editor));
            await ctx.reply(view.text, { reply_markup: view.keyboard });
        } catch (err) {
            if (err instanceof Errors) {
                await ctx.reply(errorText(ctx.lang, err.message));
            } else {
                console.error("member update failed:", err);
                await ctx.reply(t(ctx.lang, 'common.errorShort'));
            }
        }
    });
}