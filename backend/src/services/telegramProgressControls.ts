import { Api } from 'telegram';
import { DEFAULT_LOCALE, type TelegramLocale } from '../i18n/telegram.js';
import { buildTaskCenterDetail, type TaskCenterItem } from './telegramTaskCenter.js';

export const TASK_CENTER_CARD_TTL_MS = 24 * 60 * 60 * 1000;
export const taskCenterCardOwners = new Map<string, { userId: number; expiresAt: number; interactive?: boolean; progress?: boolean }>();
export function taskCenterCardKey(chatId: string, messageId: number): string {
    return `${chatId}:${messageId}`;
}

export function registerProgressCard(chatId: string, messageId: number, userId: number): void {
    taskCenterCardOwners.set(taskCenterCardKey(chatId, messageId), { userId, expiresAt: Date.now() + TASK_CENTER_CARD_TTL_MS, progress: true });
}

/** Once opened as a task detail/confirmation, background edits must not replace it. */
export function isInteractiveProgressCard(chatId: string, messageId: number): boolean {
    return Boolean(taskCenterCardOwners.get(taskCenterCardKey(chatId, messageId))?.interactive);
}

export function buildProgressControlButtons(items: TaskCenterItem[], locale: TelegramLocale = DEFAULT_LOCALE): Api.ReplyInlineMarkup | undefined {
    const rows = items.map(item => buildTaskCenterDetail(item, 0, { locale }).rows[0]);
    if (!rows.length) return undefined;
    return new Api.ReplyInlineMarkup({ rows: rows.map(row => new Api.KeyboardButtonRow({
        buttons: row.map(button => new Api.KeyboardButtonCallback({ text: button.text, data: Buffer.from(button.data) })),
    })) });
}
