import { Bot, InputFile } from 'grammy';
import { MyContext } from '../server';
import MemberService from '../models/Member.service';
import BranchService from '../models/Branch.service';
import CleaningService from '../models/Cleaning.service';
import { Member } from '../libs/types/member';
import { CleaningPlace, CLEANING_PLACE_NAMES, CLEANING_PLACE_NAMES_TR } from '../libs/enums/cleaning.enum';
import { MemberType } from '../libs/enums/member.enum';
import { hasManagerPermission, isBossOrAdmin } from '../libs/utils/permission';
import { currentWeekStartSeoul } from '../libs/utils/date';
import { nowInSeoul } from '../libs/utils/time';
import { buildCleaningPptx } from '../libs/utils/cleaningPptx';
import { allLabels, t, Lang, DEFAULT_LANG } from '../libs/i18n';
import { cleaningPlacesView, cleaningUploadView, cleaningOverviewView, cleaningSubmitView } from '../views/index';

const memberService = new MemberService();
const branchService = new BranchService();
const cleaningService = new CleaningService();

function isPlace(value: string): value is CleaningPlace {
    return Object.values(CleaningPlace).includes(value as CleaningPlace);
}

function seoulDateText(): string {
    const d = nowInSeoul();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}

export function cleaningController(bot: Bot<MyContext>) {

    // everyone except boss/admin, and they need a branch to upload for
    async function getCleaner(ctx: MyContext): Promise<Member | null> {
        if (!ctx.from) return null;
        const member = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!member || isBossOrAdmin(member) || !member.branchId) return null;
        return member;
    }

    async function placesView(lang: Lang, member: Member, note?: string) {
        const pairs = await cleaningService.getPairs(member.branchId!, currentWeekStartSeoul());
        const mine = new Set(pairs.filter(p => p.memberId.equals(member._id)).map(p => p.place));
        return cleaningPlacesView(lang, mine, note);
    }

    // 1. Employee opens the place list
    bot.hears(allLabels('menu.cleaning'), async (ctx) => {
        const member = await getCleaner(ctx);
        if (!member) {
            await ctx.reply(t(ctx.lang, 'clean.noBranch'));
            return;
        }
        ctx.session.cleaning = undefined;
        if (await cleaningService.isDone(member._id, currentWeekStartSeoul())) {
            await ctx.reply(t(ctx.lang, 'clean.finished'));
            return;
        }
        const view = await placesView(ctx.lang, member);
        await ctx.reply(view.text, { reply_markup: view.keyboard });
    });

    // 2. Place chosen: wait for the before photo
    bot.callbackQuery(/^clean_place:/, async (ctx) => {
        const member = await getCleaner(ctx);
        const place = ctx.callbackQuery.data.split(':')[1];
        if (!member || !isPlace(place)) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.noPermissionShort') });
            return;
        }
        if (await cleaningService.isDone(member._id, currentWeekStartSeoul())) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'clean.finished'), show_alert: true });
            return;
        }
        await ctx.answerCallbackQuery();
        ctx.session.cleaning = { place };
        const view = cleaningUploadView(ctx.lang, place);
        await ctx.editMessageText(view.text, { reply_markup: view.keyboard });
    });

    // 3. Photos: one album of two photos (1st = before, 2nd = after) -> one pair.
    // Telegram delivers an album as separate updates sharing a media_group_id.
    bot.on("message:photo", async (ctx, next) => {
        const state = ctx.session.cleaning;
        if (!state) return next();
        const member = await getCleaner(ctx);
        if (!member) return next();

        const weekStart = currentWeekStartSeoul();
        if (await cleaningService.isDone(member._id, weekStart)) {
            ctx.session.cleaning = undefined;
            await ctx.reply(t(ctx.lang, 'clean.finished'));
            return;
        }

        const albumId = ctx.message.media_group_id;
        if (!albumId) {
            await ctx.reply(t(ctx.lang, 'clean.sendAlbum'));
            return;
        }
        if (albumId === ctx.session.lastCleaningAlbumId) return; // extra photo of an album already saved

        if (state.albumId !== albumId) {
            state.albumId = albumId;
            state.photos = [];
        }
        state.photos!.push({ messageId: ctx.message.message_id, fileId: ctx.message.photo[ctx.message.photo.length - 1].file_id });
        if (state.photos!.length < 2) return;

        const [before, after] = [...state.photos!].sort((a, b) => a.messageId - b.messageId);
        await cleaningService.addPair({
            branchId: member.branchId!,
            memberId: member._id,
            memberName: member.name,
            place: state.place,
            beforeFileId: before.fileId,
            afterFileId: after.fileId,
            weekStart,
        });
        ctx.session.lastCleaningAlbumId = albumId;
        ctx.session.cleaning = undefined;
        const view = await placesView(ctx.lang, member, t(ctx.lang, 'clean.saved'));
        await ctx.reply(view.text, { reply_markup: view.keyboard });
    });

    // text while waiting for a photo
    bot.on("message:text", async (ctx, next) => {
        if (!ctx.session.cleaning) return next();
        await ctx.reply(t(ctx.lang, 'clean.sendAlbumOrBack'));
    });

    // 4. Back to the place list (drops a half-finished pair)
    bot.callbackQuery("clean_back", async (ctx) => {
        const member = await getCleaner(ctx);
        await ctx.answerCallbackQuery();
        if (!member) return;
        ctx.session.cleaning = undefined;
        const view = await placesView(ctx.lang, member);
        await ctx.editMessageText(view.text, { reply_markup: view.keyboard });
    });

    // 5. "Hammasi mendan": finish for the week (uploads are locked) and tell the branch managers
    bot.callbackQuery("clean_done", async (ctx) => {
        const member = await getCleaner(ctx);
        if (!member) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.noPermissionShort') });
            return;
        }
        const weekStart = currentWeekStartSeoul();
        if (await cleaningService.isDone(member._id, weekStart)) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'clean.finished'), show_alert: true });
            return;
        }
        const mine = (await cleaningService.getPairs(member.branchId!, weekStart)).filter(p => p.memberId.equals(member._id));
        if (mine.length === 0) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'clean.needOne'), show_alert: true });
            return;
        }
        await cleaningService.markDone(member.branchId!, member._id, member.name, weekStart);
        ctx.session.cleaning = undefined;
        await ctx.answerCallbackQuery();
        await ctx.editMessageText(t(ctx.lang, 'clean.thanks'));

        const managers = (await memberService.getAllMembers()).filter(m =>
            m.type === MemberType.MANAGER && m.branchId?.equals(member.branchId!) && m.telegramId !== member.telegramId);
        for (const m of managers) {
            const mLang = m.language ?? DEFAULT_LANG; // each manager is notified in their own language
            const places = [...new Set(mine.map(p => t(mLang, `placeName.${p.place}`)))].join(', ');
            await ctx.api.sendMessage(m.telegramId, t(mLang, 'clean.notifyManager', { name: member.name, places }))
                .catch((err) => console.error(`cleaning notify failed for ${m.telegramId}:`, err));
        }
    });

    // ---- manager side ----

    bot.hears(allLabels('menu.cleaningControl'), async (ctx) => {
        if (!ctx.from) return;
        const member = await memberService.getMemberByTelegramId(ctx.from.id);
        if (!member || !hasManagerPermission(member)) {
            await ctx.reply(t(ctx.lang, 'common.noPermission'));
            return;
        }
        const weekStart = currentWeekStartSeoul();
        const [pairs, done] = await Promise.all([
            cleaningService.getPairs(member.branchId!, weekStart),
            cleaningService.getDone(member.branchId!, weekStart),
        ]);
        const counts = new Map<CleaningPlace, number>();
        for (const p of pairs) counts.set(p.place, (counts.get(p.place) ?? 0) + 1);
        const view = cleaningOverviewView(ctx.lang, counts, done.map(d => d.memberName));
        await ctx.reply(view.text, { reply_markup: view.keyboard });
    });

    async function fetchPhoto(ctx: MyContext, fileId: string): Promise<string> {
        const file = await ctx.api.getFile(fileId);
        const res = await fetch(`https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`);
        if (!res.ok) throw new Error(`photo download failed: ${res.status}`);
        return `image/jpeg;base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
    }

    // build the deck for one place and send it to the manager with a "submit to Boss" button
    bot.callbackQuery(/^clean_view:/, async (ctx) => {
        const member = await memberService.getMemberByTelegramId(ctx.from.id);
        const place = ctx.callbackQuery.data.split(':')[1];
        if (!member || !hasManagerPermission(member) || !isPlace(place)) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.noPermissionShort') });
            return;
        }
        const pairs = await cleaningService.getPairs(member.branchId!, currentWeekStartSeoul(), place);
        if (pairs.length === 0) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'clean.noPairs'), show_alert: true });
            return;
        }
        await ctx.answerCallbackQuery({ text: t(ctx.lang, 'clean.preparing') });

        try {
            const branch = await branchService.getBranchById(member.branchId!);
            const placeName = CLEANING_PLACE_NAMES[place];
            const dateText = seoulDateText();
            const deck = await buildCleaningPptx({
                branchName: branch?.name ?? '—',
                placeName,
                dateText,
                pairs,
                getImage: (fileId) => fetchPhoto(ctx, fileId),
            });
            const view = cleaningSubmitView(ctx.lang, place);
            await ctx.replyWithDocument(new InputFile(deck, `cleaning-${place.toLowerCase()}-${dateText}.pptx`), {
                caption: `Esselamu aleyküm!\n${branch?.name ?? ''} şubesi, bu haftaki ${CLEANING_PLACE_NAMES_TR[place]} temizliği ektedir (${dateText}).\nİlginiz için teşekkürler!`,
                reply_markup: view.keyboard,
            });
        } catch (err) {
            console.error("cleaning pptx failed:", err);
            await ctx.reply(t(ctx.lang, 'clean.deckFailed'));
        }
    });

    // send exactly the deck the manager just previewed to the cleaning group
    bot.callbackQuery(/^clean_submit:/, async (ctx) => {
        const member = await memberService.getMemberByTelegramId(ctx.from.id);
        const message = ctx.callbackQuery.message;
        if (!member || !hasManagerPermission(member) || !message) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'common.noPermissionShort') });
            return;
        }
        const branch = await branchService.getBranchById(member.branchId!);
        if (!branch?.cleaningGroupId) {
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'clean.noGroup'), show_alert: true });
            return;
        }
        try {
            await ctx.api.copyMessage(branch.cleaningGroupId, message.chat.id, message.message_id);
        } catch (err) {
            console.error("send cleaning deck to group failed:", err);
            await ctx.answerCallbackQuery({ text: t(ctx.lang, 'clean.groupFailed'), show_alert: true });
            return;
        }
        await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {}); // no double submit
        await ctx.answerCallbackQuery({ text: t(ctx.lang, 'clean.sentToGroup') });
    });
}
