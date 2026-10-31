const REQUIRED = ['MONGO_URL', 'BOT_TOKEN'] as const;

// stop at startup with a clear message instead of failing later inside a handler
export function assertConfig(): void {
    const missing = REQUIRED.filter(key => !process.env[key]);
    if (missing.length > 0) {
        console.error(`Missing environment variables: ${missing.join(', ')}. See .env.example.`);
        process.exit(1);
    }
}

// ADMIN_TELEGRAM_IDS=123456789,987654321 : these accounts are always admins
export function adminTelegramIds(): number[] {
    return (process.env.ADMIN_TELEGRAM_IDS ?? '')
        .split(',')
        .map(id => Number(id.trim()))
        .filter(id => Number.isInteger(id) && id > 0);
}

// REPORT_CUTOFF_DAY=25 : from this day of the month on, reports are for the month in progress
// (employees submit at month end); before it, for the month that just ended (late submitters)
export function reportCutoffDay(): number {
    const day = Number(process.env.REPORT_CUTOFF_DAY);
    return Number.isInteger(day) && day >= 2 && day <= 28 ? day : 25;
}
