export enum ProductCategory {
    FRESH = 'FRESH', DRY = 'DRY', SAUCE = 'SAUCE', SPICE = 'SPICE', WRAP = 'WRAP',
    CONTAINER = 'CONTAINER', DISPOSABLE = 'DISPOSABLE', DINE_IN = 'DINE_IN',
    HYGIENE = 'HYGIENE', CLEANING = 'CLEANING', CASHIER = 'CASHIER',
}

export const CATEGORY_LABELS: Record<ProductCategory, string> = {
    FRESH: '🥬 Yangi mahsulotlar',
    DRY: "🍚 Quruq mahsulotlar va yog'lar",
    SAUCE: '🥫 Souslar',
    SPICE: '🌶 Ziravorlar va choy',
    WRAP: "📄 Qog'ozlar va qopqoqlar",
    CONTAINER: '📦 Take-out idishlar',
    DISPOSABLE: '🛍 Take-out aksessuarlar',
    DINE_IN: '🍽 Zal uchun idishlar',
    HYGIENE: '🧻 Gigiena',
    CLEANING: '🧽 Tozalash',
    CASHIER: '🧾 Kassa',
};