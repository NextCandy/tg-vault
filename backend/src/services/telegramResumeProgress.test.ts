import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { Api } from 'telegram';
import { t } from '../i18n/telegram.js';
import { registerProgressCard, taskCenterCardOwners, taskCenterCardKey, isInteractiveProgressCard, TASK_CENTER_CARD_TTL_MS, buildProgressControlButtons } from './telegramProgressControls.js';
import { parseTaskCenterCallback, buildTaskCenterDetail } from './telegramTaskCenter.js';

function load(file: string, name: string, bindings: Record<string, unknown>) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const node = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name)!;
    const code = ts.transpileModule(node.getText(ast).replace(/^export /, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
    return vm.runInNewContext(`${code}; ${name}`, { console, Date, process, ...bindings });
}
const item = { sourceType: 'memory', id: 's123', kind: 'single', title: 'file', state: 'running', total: 2, active: 1, pending: 1, completed: 0, failed: 0, skipped: 0, createdAt: 1, updatedAt: 1 } as any;

for (const mode of ['single', 'consolidated', 'channel'] as const) {
    test(`${mode}: actual pause/resume callback restores live edits, bytes and speed`, async () => {
        taskCenterCardOwners.clear();
        const payloads: any[] = [];
        const client = { invoke: async (p: any) => payloads.push(p), editMessage: async (_: any, p: any) => { payloads.push(p); return { id: 7 }; } };
        registerProgressCard('42', 7, 42);
        const safeEditMessage = load('./telegramUpload.ts', 'safeEditMessage', { isInteractiveProgressCard, floodWaitUntil: 0, silentSessionMap: new Map() });
        const renderProgress = async () => safeEditMessage(client, '42', { message: 7, text: '2 MB / 10 MB · 1 MB/s', buttons: buildProgressControlButtons([item]) });
        const callback = load('./telegramCommands.ts', 'handleTaskCenterCallback', {
            Api, t, MSG: {}, getTelegramUserLocaleOrDefault: async () => 'zh-CN', isAuthenticatedAsync: async () => true,
            parseTaskCenterCallback, getCallbackChatKey: () => '42', taskCenterCardKey, taskCenterCardOwners, TASK_CENTER_CARD_TTL_MS,
            findTaskCenterItem: async () => item, buildTaskCenterDetail,
            editTaskCenterView: async (_: any, __: any, view: any) => payloads.push(view),
            renderTaskCenterList: async () => {}, pendingTaskCenterCancels: new Map(), taskCenterCancelKey: (...args: any[]) => args.join(':'),
            pauseDownloadTaskGroup: () => ({ status: 'ok', group: { state: 'paused' } }),
            resumeDownloadTaskGroup: () => ({ status: 'ok', group: { state: 'running' } }),
            operateChannelTaskCenterItem: async () => ({ ok: true, toast: 'ok' }),
            refreshSilentProgress: async () => {}, refreshDownloadProgress: renderProgress,
        });
        const update = { userId: { toJSNumber: () => 42 }, msgId: 7, peer: '42', queryId: 1 };
        const suffix = mode === 'channel' ? 'c' : 'm';
        await callback(client, update, `tc_a_p_${suffix}_s123_0`);
        assert.equal(isInteractiveProgressCard('42', 7), true);
        const count = payloads.length;
        await renderProgress();
        assert.equal(payloads.length, count, 'confirmation/detail remains protected while paused');
        await callback(client, update, `tc_a_r_${suffix}_s123_0`);
        assert.equal(isInteractiveProgressCard('42', 7), false);
        await renderProgress();
        assert.match(payloads.at(-1).text, /2 MB.*10 MB.*1 MB\/s/);
        assert.ok(payloads.at(-1).buttons);
        // Another user cannot release the live card or operate its queue.
        taskCenterCardOwners.get('42:7')!.interactive = true;
        await callback(client, { ...update, userId: { toJSNumber: () => 99 } }, `tc_a_r_${suffix}_s123_0`);
        assert.equal(isInteractiveProgressCard('42', 7), true);
        // A list card must not become a live tracker.
        taskCenterCardOwners.set('42:7', { userId: 42, expiresAt: Date.now() + 10000, interactive: true });
        await callback(client, update, `tc_a_r_${suffix}_s123_0`);
        assert.equal(isInteractiveProgressCard('42', 7), true);
    });
}

test('actual consolidated send then resume refresh edits same owned card with updated telemetry', async () => {
    taskCenterCardOwners.clear();
    const edits: any[] = [];
    const ids = new Map();
    let bytes = '1 MB / 10 MB · 1 MB/s';
    const client = { editMessage: async (_: any, p: any) => { edits.push(p); return { id: 7 }; } };
    const safeEditMessage = load('./telegramUpload.ts', 'safeEditMessage', { isInteractiveProgressCard, floodWaitUntil: 0, silentSessionMap: new Map() });
    const refresh = load('./telegramUpload.ts', 'refreshConsolidatedMessage', {
        silentSessionMap: new Map(), getBackgroundFileCount: () => 2, appendTelegramDebugLog: () => {},
        getConsolidatedFiles: () => [item], getConsolidatedBatches: () => [], buildConsolidatedStatus: async () => bytes,
        lastStatusMessageIdMap: ids, taskCenterCardOwners, taskCenterCardKey, listDownloadTaskGroups: () => [item], ordinaryTaskCenterItem: (x: any) => x,
        DEFAULT_LOCALE: 'zh-CN', getTelegramUserLocaleOrDefault: async () => 'zh-CN', buildProgressControlButtons,
        deleteLastStatusMessage: async () => {}, safeReply: async (_: any, p: any) => { edits.push(p); return { id: 7 }; },
        updateLastStatusMessageId: (chat: string, id: number) => ids.set(chat, id), registerProgressCard, safeEditMessage, isInteractiveProgressCard,
    });
    await refresh(client, '42', { senderId: { toJSNumber: () => 42 } });
    assert.ok(edits[0].buttons);
    taskCenterCardOwners.get('42:7')!.interactive = true;
    await refresh(client, '42');
    assert.equal(edits.length, 1);
    taskCenterCardOwners.get('42:7')!.interactive = false;
    bytes = '3 MB / 10 MB · 2 MB/s';
    await refresh(client, '42');
    assert.equal(edits[1].message, 7);
    assert.equal(edits[1].text, bytes);
});

test('resume wording matches in paused and pausing states in all locales', () => {
    for (const locale of ['zh-CN', 'en', 'ru'] as const) {
        assert.equal(t(locale, 'taskCenter.button.undoPause'), t(locale, 'taskCenter.button.resume'));
        assert.equal(t(locale, 'task.resume'), t(locale, 'taskCenter.button.resume'));
    }
    assert.equal(t('zh-CN', 'task.resume'), '▶️ 继续任务');
});
