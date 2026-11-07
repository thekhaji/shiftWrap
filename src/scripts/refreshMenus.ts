import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import { Api } from 'grammy';
import MemberService from '../models/Member.service';
import { menuUpdatedView } from '../views/index';

const SEND_DELAY_MS = 50; // stay comfortably under Telegram's ~30 msg/sec global rate limit

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
    await mongoose.connect(process.env.MONGO_URL as string);
    console.log("MongoDB connected");

    const api = new Api(process.env.BOT_TOKEN as string);
    const memberService = new MemberService();
    const members = await memberService.getAllMembers();

    console.log(`Refreshing menu for ${members.length} member(s)...`);

    let sent = 0;
    let failed = 0;

    for (const member of members) {
        try {
            const view = await menuUpdatedView(member);
            await api.sendMessage(member.telegramId, view.text, { reply_markup: view.keyboard });
            sent++;
        } catch (err: any) {
            failed++;
            console.error(`Failed to message telegramId=${member.telegramId}: ${err.description ?? err.message}`);
        }
        await sleep(SEND_DELAY_MS);
    }

    console.log(`Done. Sent: ${sent}, Failed: ${failed}`);

    await mongoose.disconnect();
    process.exit(0);
}

main().catch((err) => {
    console.error("Broadcast script failed:", err);
    process.exit(1);
});
