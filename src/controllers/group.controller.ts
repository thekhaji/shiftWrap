import { Bot } from 'grammy';
import { MyContext } from '../server';
import GroupService from '../models/Group.service';

const groupService = new GroupService();
const seen = new Map<number, string>(); // chatId -> title, so a busy group doesn't write on every message

// Remembers every group the bot is in, for the admin's group picker in branch settings.
// Whether the bot is an admin there is checked when the list is shown.
export function groupController(bot: Bot<MyContext>) {
    bot.on("my_chat_member", async (ctx, next) => {
        const chat = ctx.chat;
        if (chat.type === 'group' || chat.type === 'supergroup') {
            const status = ctx.myChatMember.new_chat_member.status;
            if (status === 'left' || status === 'kicked') {
                seen.delete(chat.id);
                await groupService.forget(chat.id);
            } else {
                seen.set(chat.id, chat.title);
                await groupService.remember(chat.id, chat.title);
            }
        }
        await next();
    });

    // groups the bot was added to before this existed are picked up on their next message
    bot.use(async (ctx, next) => {
        const chat = ctx.chat;
        if (chat && (chat.type === 'group' || chat.type === 'supergroup') && seen.get(chat.id) !== chat.title) {
            seen.set(chat.id, chat.title);
            await groupService.remember(chat.id, chat.title).catch((err) => console.error("remember group failed:", err));
        }
        await next();
    });
}
