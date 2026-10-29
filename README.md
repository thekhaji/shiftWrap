# ShiftWrap

A Telegram bot for a multi-branch company: attendance (check in / out by location), weekly cleaning reports,
product ordering with the group topics, monthly reports and payroll.

## Roles

| Role | How they get it | Can do |
| --- | --- | --- |
| Employee | registers, then the branch manager confirms | check in / out, own reports, cleaning, submit the monthly report |
| Manager | assigned by a boss or admin (only one per branch) | everything an employee can, plus confirm employees, approve report edits, order, cleaning review, edit employee pay details, branch report, payroll, payroll status |
| Assistant | assigned by a boss or admin (any number per branch, next to the manager) | the manager's day-to-day work: confirm employees, order, cleaning review, change phone numbers. **No pay access:** no rate / bank details, branch report, payroll, payroll status or approving report edits |
| Boss | one-time invite link from an admin | branch reports and payroll for all branches, reopen a month |
| Admin | `ADMIN_TELEGRAM_IDS` | branches, managers and assistants, groups, product catalog, boss invites |

## Setup

```bash
npm install
cp .env.example .env     # fill in BOT_TOKEN, MONGO_URL, ADMIN_TELEGRAM_IDS
npm run start:dev        # development, restarts on changes
npm test                 # unit tests
```

Production: `npm run build`, then `npm run start:prod` under a process manager (pm2, systemd, Docker).
The `Dockerfile` does the same. MongoDB must be a **replica set** (Atlas is): the menu refresh uses a change stream.

Use a separate bot token and a separate database for development and production.

## Scripts

| Command | |
| --- | --- |
| `npm run refresh-menus` | sends everyone the newest menu keyboard; run after a release that adds buttons |
| `npm run migrate-products` | one-off, only for databases from before the shared product catalog |

## How things work

- **Registration:** language, phone, then "which branch were you invited to?". The branch's managers confirm (bosses and
  admins if the branch has none). Until confirmed an employee can only use `/start`.
- **Monthly report:** the employee downloads last month's Excel, may edit the From / To times, and sends it back.
  A report without edits is submitted at once. Edits wait for a manager's approval and are applied only then.
  When every employee of a branch is approved the month is closed and the bosses get the payroll report.
  A manager, boss or admin can reopen a closed month from **Payroll status**.
- **Manager and assistant:** a manager without a role (created before assistants existed) counts as the main manager.
  Report-edit approvals go to the main manager only; with none, to the bosses and admins.
- **Order groups:** assigning an order group creates its three topics (new, ordered, received) in the group.
  The bot must be a group admin with the "Manage topics" right.
- **Sessions** are stored in MongoDB, so restarts don't lose half-finished flows.

## Time handling (read before touching dates)

Shift times are stored as **Seoul wall-clock time labeled as UTC**: a check-in at 09:00 in Seoul is saved as
`09:00Z`. This keeps reports simple (a day is just a UTC day) but it means:

- When **writing** a shift time use `nowInSeoul()` from `src/libs/utils/time.ts`.
- When **reading** always use the `getUTC*` methods and `toLocaleString(..., { timeZone: 'UTC' })`.
  Never use local-time getters; they would apply the offset a second time.
- Month boundaries come from `monthRange()` / `previousMonthSeoul()` in `src/libs/utils/date.ts`.
- Do not compare these dates with a real `Date.now()`; use `nowInSeoul()`.

## Configuration

| Variable | |
| --- | --- |
| `BOT_TOKEN`, `MONGO_URL` | required |
| `ADMIN_TELEGRAM_IDS` | comma separated Telegram ids that are always admins |
| `ERROR_CHAT_ID` | Telegram chat that receives error alerts |
| `DEBUG_UPDATES` | `true` logs every chat id (debugging only) |
