import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import {Bot, Context, session, SessionFlavor} from 'grammy'
import { memberController } from './controllers/member.controller';
import { attendanceController } from './controllers/attendance.controller';
import { navigationController } from './controllers/navigation.controller';
import { branchController } from './controllers/branch.controller';
import { reportController } from './controllers/report.controller';
import { EditableMemberField } from './libs/types/member';

export interface SessionData {
    awaitingAction?: "checkin" | "checkout" | "register_branch_name" | "register_branch_location" | "edit_member_field";
    awaitingSince?: number;
    pendingBranchName?: string;
    editingMemberTelegramId?: number;
    editingField?: EditableMemberField;
}

export type MyContext = Context & SessionFlavor<SessionData>;

mongoose.connect(process.env.MONGO_URL as string)
.then((data)=>{
    console.log("MongoDB connected successfully");
    const bot = new Bot<MyContext>(process.env.BOT_TOKEN as string);
    bot.use(session({ initial: (): SessionData => ({}) }));
    navigationController(bot); // first: its middleware resets pending prompts on menu taps
    memberController(bot);
    attendanceController(bot);
    branchController(bot);
    reportController(bot);
    bot.start();
})
.catch((err)=>{
    console.error("MongoDB connection error:", err);
});
