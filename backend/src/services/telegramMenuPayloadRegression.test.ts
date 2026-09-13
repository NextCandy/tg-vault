import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { Api } from 'telegram';
import { t } from '../i18n/telegram.js';
import { DestructiveConfirmationStore } from './destructiveConfirmation.js';
import { buildTelegramFileActionRows, parseTelegramFileCallback, encodeTelegramFileCallback, buildTelegramFileDetail } from './telegramFileBrowser.js';
import { buildNotificationSettingsButtonRows, buildNotificationSettingsText, notificationCallbackArgs, updateNotificationPreference } from './telegramNotificationSettings.js';

// Execute production function bodies with only explicit offline dependencies.
// Importing telegramCommands directly would load storage/accounts and workers.
// Optional baseline mode reproduces historical failures without touching the worktree.
const source = process.env.TELEGRAM_MENU_BASELINE
    ? execFileSync('git', ['show', `${process.env.TELEGRAM_MENU_BASELINE}:backend/src/services/telegramCommands.ts`], { cwd: new URL('../../../', import.meta.url), encoding: 'utf8' })
    : fs.readFileSync(new URL('./telegramCommands.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('commands.ts', source, ts.ScriptTarget.Latest, true);
function isolated(names: string[], bindings: Record<string, unknown> = {}) {
    const declarations = names.map(name => {
        const node = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
        assert.ok(node, name);
        return node.getText(ast).replace(/^export /, '');
    }).join('\n');
    const code = ts.transpileModule(declarations, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
    return vm.runInNewContext(`${code}; ({${names.join(',')}})`, {
        Api, Buffer, t, DEFAULT_LOCALE: 'zh-CN', console: { error() {} },
        MSG: { AUTH_REQUIRED: 'auth required' },
        isAuthenticatedAsync: async () => true,
        getTelegramUserLocaleOrDefault: async () => 'en',
        getCallbackChatKey: (u: any) => u.peer.chat,
        ...bindings,
    });
}
const id = '12345678-1234-1234-1234-123456789012';
const update = (actor = 7, chat = '-10099', msgId = 15) => ({ userId: { toJSNumber: () => actor }, peer: { chat }, msgId, queryId: 1n });
function client(noChange = false) {
    const edits: any[] = [], answers: any[] = [], sends: any[] = [];
    return { edits, answers, sends,
        editMessage: async (_: unknown, payload: any) => { edits.push(payload); if (noChange) throw { code: 400, errorMessage: 'MESSAGE_NOT_MODIFIED' }; },
        invoke: async (payload: any) => { answers.push(payload); },
        sendMessage: async (_: unknown, payload: any) => { sends.push(payload); return { id: 15, message: payload.message, edit: async (p: any) => edits.push(p) }; },
    };
}
function callbacks(markup: any): string[] { return markup.rows.flatMap((r: any) => r.buttons.map((b: any) => b.data.toString())); }

test('start/help forward complete caller keyboards and unauthenticated start does not expose home', async () => {
    const sent: any[] = [], passwordInputState = new Map();
    let authenticated = true;
    const { handleStart, handleHelp } = isolated(['handleStart', 'handleHelp'], {
        passwordInputState, isAuthenticatedAsync: async () => authenticated,
        buildWelcomeBack: () => 'welcome body', buildHelp: () => 'help body',
    });
    const message = { reply: async (p: any) => sent.push(p) };
    const buttons = new Api.ReplyInlineMarkup({ rows: [] });
    await handleStart(message, 7, buttons, 'en');
    await handleHelp(message, buttons, 'en');
    assert.equal(sent[0].buttons, buttons); assert.equal(sent[1].buttons, buttons);
    assert.equal(sent[1].message, 'help body');
    authenticated = false; await handleStart(message, 7, buttons, 'en');
    assert.equal(sent.length, 2); assert.ok(passwordInputState.has(7));
});

test('list payload exposes every displayed file, including entries 9–12, with routed detail callbacks', async () => {
    const files = Array.from({ length: 12 }, (_, i) => ({ id: id.slice(0, -2) + String(i).padStart(2, '0'), name: `file ${i}` }));
    const sent: any[] = [];
    const { handleList } = isolated(['handleList', 'buildFileSearchKeyboard'], {
        getCurrentStorageScope: async () => ({ clause: 'source = $1', params: ['local'] }),
        nextParam: (_: unknown, n: number) => `$${n + 1}`, query: async () => ({ rows: files }),
        buildFileList: () => 'list body', encodeTelegramFileCallback,
    });
    await handleList({ reply: async (p: any) => sent.push(p) }, ['12'], 'en');
    assert.equal(sent[0].message, 'list body');
    assert.equal(callbacks(sent[0].buttons).length, files.length);
    callbacks(sent[0].buttons).forEach((data, i) => assert.equal(parseTelegramFileCallback(data)?.fileId, files[i].id));
});

test('detail refresh keeps action keyboard and acknowledges MESSAGE_NOT_MODIFIED', async () => {
    const file = { id, name: 'file.pdf', source: 'local' };
    const { handleTelegramFileBrowserCallback } = isolated(['handleTelegramFileBrowserCallback', 'buildFileActionKeyboard', 'isTelegramMessageNotModified'], {
        parseTelegramFileCallback, getScopedFileById: async () => file, buildTelegramFileDetail, buildTelegramFileActionRows,
    });
    const c = client(true);
    await handleTelegramFileBrowserCallback(c, update(), `fb_detail_${id}`);
    assert.equal(callbacks(c.edits[0].buttons).length, 7);
    assert.equal(c.answers.length, 1); assert.equal(c.answers[0].alert, undefined);
});

test('delete asks first; foreign actor/chat/message cannot consume or cancel; owner cancel prevents replay', async () => {
    const confirmations = new DestructiveConfirmationStore({ tokenFactory: () => 'test-token' });
    const pending = new Map();
    let removals = 0;
    const functions = isolated(['handleTelegramFileBrowserCallback', 'buildDeleteConfirmKeyboard', 'handleDeleteConfirmCallback'], {
        parseTelegramFileCallback, getScopedFileById: async () => ({ id, name: 'file.pdf', source: 'local' }),
        destructiveConfirmations: confirmations, pendingDeleteConfirmations: pending,
        removePhysicalFile: async () => { removals++; },
        getCurrentStorageScope: async () => { throw new Error('must not query on cancellation'); },
    });
    const c = client();
    await functions.handleTelegramFileBrowserCallback(c, update(), `fb_delete_${id}`);
    assert.equal(removals, 0);
    const [confirm, cancel] = callbacks(c.edits[0].buttons);
    assert.equal(confirm, 'del_confirm_test-token');
    for (const foreign of [update(8), update(7, '-10088'), update(7, '-10099', 16)]) {
        await functions.handleDeleteConfirmCallback(c, foreign, confirm);
        await functions.handleDeleteConfirmCallback(c, foreign, cancel);
        assert.ok(pending.has('test-token'));
    }
    await functions.handleDeleteConfirmCallback(c, update(), cancel);
    assert.equal(pending.size, 0); assert.equal(c.edits.at(-1).buttons.rows.length, 0);
    await functions.handleDeleteConfirmCallback(c, update(), confirm);
    assert.equal(removals, 0);
});

test('localized file mutation cancellation is scoped and never becomes a folder mutation', async () => {
    for (const input of ['Cancel', '/cancel', 'Отмена', '取消']) {
        const pending = new Map([['7:-10099', { fileId: id, action: 'move', expiresAt: Date.now() + 10000 }]]);
        const { applyPendingTelegramFileMutation } = isolated(['applyPendingTelegramFileMutation'], {
            pendingTelegramFileMutations: pending, canonicalTelegramChatKey: (s: string) => s,
            getScopedFileById: async () => { throw new Error('cancel must not read or mutate file'); },
        });
        const message = { chatId: { toString: () => '-10099' }, reply: async () => {} };
        assert.equal(await applyPendingTelegramFileMutation(message, 8, input), false);
        assert.equal(await applyPendingTelegramFileMutation(message, 7, input), true);
        assert.equal(pending.size, 0);
    }
});

test('storage refresh edits text and keyboard without switching or failing on unchanged view', async () => {
    let switched = 0;
    const { handleStorageSwitchCallback } = isolated(['handleStorageSwitchCallback', 'editStorageSwitchMessage', 'isTelegramMessageNotModified'], {
        buildStorageSwitchView: async () => ({ text: 'storage body', buttons: { marker: 'accounts' } }),
        storageManager: { switchAccount: async () => switched++ },
    });
    const c = client(true);
    await handleStorageSwitchCallback(c, update(), 'storage_switch_refresh');
    assert.equal(switched, 0); assert.equal(c.edits[0].buttons.marker, 'accounts');
    assert.equal(c.answers.length, 1); assert.equal(c.answers[0].alert, undefined);
});

test('target callbacks round-trip keyboard and reject stale/unknown actions without session writes', async () => {
    const writes: any[] = [];
    const { handleTargetCallback, buildTargetKeyboard } = isolated(['handleTargetCallback', 'buildTargetKeyboard'], {
        storageManager: { getActiveTarget: () => ({ provider: { name: 'local' }, accountId: null }) },
        setTelegramTargetState: async (...args: any[]) => writes.push(args), clearTelegramTargetState: async (...args: any[]) => writes.push(args),
        getTelegramTargetState: async () => null, getProviderDisplayName: (s: string) => s,
    });
    const c = client();
    await handleTargetCallback(c, update(), 'target_refresh'); assert.equal(writes.length, 0);
    for (const data of callbacks(buildTargetKeyboard('en'))) await handleTargetCallback(c, update(), data);
    assert.equal(writes.length, 3); assert.equal(writes[0][1], '-10099'); assert.equal(writes[0][2], 'once'); assert.equal(writes[1][2], 'session');
    assert.equal(callbacks(c.edits.at(-1).buttons).length, 3);
});

test('path and settings repeated clicks keep keyboards and do not report false failure', async () => {
    for (const [name, data, extras] of [
        ['handlePathRulesCallback', 'pr_clear_custom', { getPathCenterState: async () => ({}), clearTelegramPathStatePersistent: async () => {}, buildPathSettingsText: () => 'path body', buildPathSettingsKeyboard: () => ({ marker: 'path' }) }],
        ['handleDuplicateModeCallback', 'dm_set_skip', { setSetting: async () => {}, buildDuplicateModeText: () => 'duplicate body', buildDuplicateModeKeyboard: () => ({ marker: 'duplicate' }) }],
        ['handleCleanupSettingsCallback', 'cs_set_off', { setSetting: async () => {}, process: { env: {} }, stopPeriodicCleanup: () => {}, buildCleanupSettingsText: () => 'cleanup body', buildCleanupSettingsKeyboard: () => ({ marker: 'cleanup' }) }],
    ] as const) {
        const f = isolated([name, 'isTelegramMessageNotModified'], extras);
        const c = client(true); await f[name](c, update(), data);
        assert.ok(c.edits[0].buttons); assert.equal(c.answers.length, 1); assert.equal(c.answers[0].alert, undefined);
    }
    let writes = 0;
    const { handleCleanupSettingsCallback } = isolated(['handleCleanupSettingsCallback'], { setSetting: async () => writes++ });
    await handleCleanupSettingsCallback(client(), update(), 'cs_refresh'); assert.equal(writes, 0);
});

test('notification buttons all round-trip; edits preserve full controls and actor/chat scope', async () => {
    const current = { security: true, successMode: 'immediate', failureImmediate: true, subscriptionDigest: false, quietStart: null, quietEnd: null, timezone: 'UTC' } as const;
    let savedArgs: any[] = [];
    const { handleNotificationsCallback } = isolated(['handleNotificationsCallback', 'buildNotificationSettingsKeyboard'], {
        buildNotificationSettingsButtonRows, buildNotificationSettingsText, notificationCallbackArgs, updateNotificationPreference,
        getTelegramNotificationPreferences: async () => current,
        setTelegramNotificationPreferences: async (...args: any[]) => { savedArgs = args; return args[2]; },
    });
    for (const button of buildNotificationSettingsButtonRows(current).flat()) assert.ok(notificationCallbackArgs(button.data));
    const c = client(); await handleNotificationsCallback(c, update(), 'nt_success_digest');
    assert.equal(savedArgs[0], 7); assert.equal(savedArgs[1], '-10099');
    assert.equal(savedArgs[2].successMode, 'digest'); assert.equal(callbacks(c.edits[0].buttons).length, 11);
    await handleNotificationsCallback(c, update(), 'nt_success_immediate');
    assert.equal(c.edits.length, 1); // already-current preference does not wipe markup
});
