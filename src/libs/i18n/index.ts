import { uz, TranslationKey } from './uz';
import { tr } from './tr';
import { en } from './en';
import { Message } from '../Errors';

export const LANGUAGES = ['uz', 'tr', 'en'] as const;
export type Lang = typeof LANGUAGES[number];
export const DEFAULT_LANG: Lang = 'uz';

export const LANGUAGE_NAMES: Record<Lang, string> = {
    uz: "🇺🇿 O'zbekcha",
    tr: '🇹🇷 Türkçe',
    en: '🇬🇧 English',
};

const dictionaries: Record<Lang, Record<TranslationKey, string>> = { uz, tr, en };

export function isLang(value: unknown): value is Lang {
    return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

export type { TranslationKey };

export function t(lang: Lang, key: TranslationKey, params?: Record<string, string | number>): string {
    const template = dictionaries[lang][key];
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? `{${name}}`));
}

// the same label in every language: used to match reply-keyboard taps whatever the user's language
export function allLabels(key: TranslationKey): string[] {
    return [...new Set(LANGUAGES.map(l => dictionaries[l][key]))];
}

// every main-menu label in every language
export function allMenuLabels(): Set<string> {
    return new Set((Object.keys(uz) as TranslationKey[]).filter(k => k.startsWith('menu.')).flatMap(allLabels));
}

export function monthNames(lang: Lang): string[] {
    return t(lang, 'months').split(',');
}

// service errors carry an English Message; show it in the user's language
export function errorText(lang: Lang, message: Message): string {
    const name = Object.entries(Message).find(([, value]) => value === message)?.[0];
    const key = `err.${name}` as TranslationKey;
    return name && key in uz ? t(lang, key) : t(lang, 'common.error');
}
