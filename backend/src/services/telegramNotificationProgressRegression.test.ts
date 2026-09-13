import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { buildSecurityLoginNotification } from './telegramLoginNotification.js';
import { TELEGRAM_LOCALES } from '../i18n/telegram.js';
import { buildProgressControlButtons, registerProgressCard, isInteractiveProgressCard, taskCenterCardOwners, taskCenterCardKey } from './telegramProgressControls.js';
import { channelTaskCenterItem, parseTaskCenterCallback, type TaskCenterItem } from './telegramTaskCenter.js';

const source = fs.readFileSync(new URL('./telegramBot.ts', import.meta.url), 'utf8');
function isolatedFunction(name: string, next: string, bindings: Record<string, unknown>) {
    const start = source.indexOf(`async function ${name}`);
    const body = source.slice(start, source.indexOf(next, start)).replace(/export default[\s\S]*/, '');
    const code = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
    return vm.runInNewContext(`${code}; ${name}`, bindings);
}
const details = { time: '2026-09-13 09:00 (Asia/Shanghai)', location: 'Example City', device: 'Browser 1 on OS 2', ip: '192.0.2.10' };

test('login details and warning survive every locale and actual sending loop', async () => {
    for (const locale of Object.keys(TELEGRAM_LOCALES) as Array<keyof typeof TELEGRAM_LOCALES>) {
        const sent: Array<{ userId: number; message: string }> = [];
        const send = isolatedFunction('sendSecurityNotification', '\nexport default', {
            client: { connected: true, sendMessage: async (userId: number, payload: { message: string }) => sent.push({ userId, ...payload }) },
            getConfiguredTelegramAllowedUsers: async () => [11, 22],
            reconcileTelegramAllowedUsers: async () => ({ recipients: [11] }),
            getTelegramUserLocaleOrDefault: async () => locale,
            buildSecurityLoginNotification, console,
        });
        await send(details);
        assert.equal(sent.length, 1);
        assert.equal(sent[0].userId, 11);
        for (const value of Object.values(details)) assert.ok(sent[0].message.includes(value));
        assert.match(sent[0].message, /💡/);
        assert.equal(sent[0].message.split('🔔').length, 2);
        assert.equal(buildSecurityLoginNotification('heading\nfull body', locale), 'heading\nfull body');
    }
});

test('progress controls use scoped task-center actions, confirmation and cooldown rules', () => {
    const base = { sourceType: 'memory', id: 's123', kind: 'single', title: 'file', total: 2, active: 1, pending: 1, completed: 0, failed: 0, skipped: 0, createdAt: 1, updatedAt: 1 } as TaskCenterItem;
    for (const sourceType of ['memory', 'channel'] as const) {
        for (const locale of Object.keys(TELEGRAM_LOCALES) as Array<keyof typeof TELEGRAM_LOCALES>) {
            for (const [state, expected] of [['running', ['pause', 'cancel_prompt']], ['paused', ['resume', 'cancel_prompt']], ['pausing', ['resume', 'cancel_prompt']], ['cooling', ['cancel_prompt']]] as const) {
                const markup = buildProgressControlButtons([{ ...base, sourceType, state }], locale)!;
                const parsed = markup.rows[0].buttons.map(button => parseTaskCenterCallback((button as any).data.toString()));
                assert.deepEqual(parsed.map(value => value?.view === 'action' ? value.action : ''), expected);
                assert.ok(parsed.every(value => value?.view === 'action' && value.sourceType === sourceType && value.id === base.id));
            }
        }
    }
    assert.equal(buildProgressControlButtons([]), undefined);
});

test('actual channel progress edit carries buttons, clears terminal controls and preserves confirmations', async () => {
    taskCenterCardOwners.clear();
    const sent: any[] = [];
    const update = isolatedFunction('updateJobProgressMessage', '\nasync function updateScanStatusMessage', {
        DEFAULT_LOCALE: 'zh-CN', isInteractiveProgressCard, channelTaskCenterItem,
        registerProgressCard, buildProgressControlButtons, buildLegacyJobProgressPresentation: () => 'progress',
    });
    const message = { chatId: { toString: () => '-100123' }, id: 7, edit: async (payload: unknown) => sent.push(payload) };
    const summary = { jobId: '1234567890abcdef', status: 'running', scanStatus: 'done', downloadStatus: 'downloading', totalMediaFound: 2, downloading: 1, pending: 1, completed: 0, failed: 0, skipped: 0 };
    await update(message, summary, 'en', 42);
    assert.ok(sent[0].buttons);
    assert.equal(taskCenterCardOwners.get(taskCenterCardKey('-100123', 7))?.userId, 42);
    await update(message, { ...summary, status: 'paused', downloading: 0 }, 'en', 42);
    assert.match(sent[1].buttons.rows[0].buttons[0].data.toString(), /^tc_a_r_c_/);
    await update(message, { ...summary, status: 'completed', downloading: 0, pending: 0, completed: 2 }, 'en', 42);
    assert.equal(sent[2].buttons, undefined);
    taskCenterCardOwners.get(taskCenterCardKey('-100123', 7))!.interactive = true;
    await update(message, summary, 'en', 42);
    assert.equal(sent.length, 3);
    assert.equal(isInteractiveProgressCard('-100999', 7), false);
    taskCenterCardOwners.clear();
});

test('ordinary progress send/edit retain controls without weakening callback ownership or cancel confirmation', () => {
    const upload = fs.readFileSync(new URL('./telegramUpload.ts', import.meta.url), 'utf8');
    const commands = fs.readFileSync(new URL('./telegramCommands.ts', import.meta.url), 'utf8');
    assert.match(upload, /safeReply\(replyTo, \{ message: text, buttons \}\)/);
    assert.match(upload, /message: existingMsgId, text, buttons/);
    assert.match(upload, /listDownloadTaskGroups\(chatIdStr, ownerId\)/);
    assert.match(commands, /owner\.userId !== userId/);
    assert.match(commands, /pendingTaskCenterCancels/);
    assert.match(commands, /findTaskCenterItem\(parsed.sourceType, parsed.id, chatId, userId\)/);
});
