import { Bot } from 'grammy';
import { MyContext } from '../server';


export function debugController(bot: Bot<MyContext>) {
    bot.on("message", async (ctx, next) => {
        console.log("Chat ID:", ctx.chat.id);
        console.log("Thread ID:", ctx.message.message_thread_id);
        await next();
    });
}
