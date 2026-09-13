import { DEFAULT_LOCALE, t, type TelegramLocale } from '../i18n/telegram.js';

export interface TelegramLoginDetails {
    time: string;
    location: string;
    device: string;
    ip: string;
}

/** Raw callers already supply a complete notification; never translate it as a heading. */
export function buildSecurityLoginNotification(details: TelegramLoginDetails | string, locale: TelegramLocale = DEFAULT_LOCALE): string {
    if (typeof details === 'string') return details;
    return t(locale, 'bot.notification.securityLogin', { ...details });
}
