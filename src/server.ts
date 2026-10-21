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
import { debugController } from './controllers/debug.controller';
import { orderController } from './controllers/order.controller';
import { productController } from './controllers/product.controller';
import { ProductCategory } from './libs/enums/product.enum';
import { CleaningPlace } from './libs/enums/cleaning.enum';
import { Lang, DEFAULT_LANG } from './libs/i18n';
import MemberService from './models/Member.service';
import { languageController } from './controllers/language.controller';
import { startMenuSync } from './libs/utils/menuSync';
import { registrationController } from './controllers/registration.controller';
import { submissionController } from './controllers/submission.controller';
import { ShiftPlan } from './libs/utils/reportEdit';
import { groupController } from './controllers/group.controller';
import { cleaningController } from './controllers/cleaning.controller';

export interface SessionData {
    awaitingAction?: "checkin" | "checkout" | "register_branch_name" | "register_branch_location" | "edit_member_field";
    awaitingSince?: number;
    pendingBranchName?: string;
    editingMemberTelegramId?: number;
    editingField?: EditableMemberField;
    addProduct?: {
        step: 'name' | 'category' | 'photo' | 'link' | 'note';
        name?: string;
        category?: ProductCategory;
        imageFileId?: string;
        orderLink?: string;
        orderNote?: string;
    };
    cleaning?: {
        place: CleaningPlace;
        albumId?: string;                                   // media_group_id of the album being collected
        photos?: { messageId: number; fileId: string }[];   // album photos so far (needs 2: before, after)
    };
    lastCleaningAlbumId?: string;  // saved album; its leftover photos are ignored
    bossInvite?: string;           // valid invite token, carried from /start until the phone is shared
    submitReport?: { branchId: string; year: number; month: number; plan?: ShiftPlan };  // report being checked before submit
    lang?: Lang;                   // chosen before registration finishes
    basketMessageIds?: number[];   // message ids of the catalog, so they can be deleted later
}

export type MyContext = Context & SessionFlavor<SessionData> & { lang: Lang };

mongoose.connect(process.env.MONGO_URL as string)
.then((data)=>{
    console.log("MongoDB connected successfully");
    const bot = new Bot<MyContext>(process.env.BOT_TOKEN as string);
    bot.use(session({ initial: (): SessionData => ({}) }));
    const memberService = new MemberService();
    // every handler reads ctx.lang: the member's saved language, or the one picked while registering
    bot.use(async (ctx, next) => {
        const member = ctx.from ? await memberService.getMemberByTelegramId(ctx.from.id) : null;
        ctx.lang = member?.language ?? ctx.session.lang ?? DEFAULT_LANG;
        await next();
    });
    groupController(bot);
    registrationController(bot); // first: blocks unconfirmed employees from everything else
    navigationController(bot);
    languageController(bot); // first: its middleware resets pending prompts on menu taps
    memberController(bot);
    attendanceController(bot);
    branchController(bot);
    reportController(bot);
    debugController(bot);
    orderController(bot);
    productController(bot);
    cleaningController(bot);
    submissionController(bot);
    startMenuSync(bot);
    bot.start();
})
.catch((err)=>{
    console.error("MongoDB connection error:", err);
});
