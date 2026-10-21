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
