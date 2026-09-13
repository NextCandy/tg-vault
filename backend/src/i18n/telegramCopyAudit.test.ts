import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { Api } from 'telegram';
import { DEFAULT_LOCALE, resources, t, type TelegramLocale } from './telegram.js';
import { buildAuthSuccess, buildBatchStatus, buildCleanupNotice, buildConsolidatedStatus, buildTaskControlButtons, buildUploadFail, buildUploadSuccess, MSG } from '../utils/telegramMessages.js';
import { BOT_COMMANDS, buildBotCommandMenu } from '../utils/telegramCommandRegistry.js';
import { buildTaskCancelConfirm, parseTaskCenterCallback, type TaskCenterItem } from '../services/telegramTaskCenter.js';

const locales = Object.keys(resources) as TelegramLocale[];
const placeholders = (value: string) => [...new Set([...value.matchAll(/\{([A-Za-z0-9_]+)(?:\}|,\s*plural,)/g)].map(match => match[1]))].sort();
const commandsSource = fs.readFileSync(new URL('../services/telegramCommands.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('telegramCommands.ts', commandsSource, ts.ScriptTarget.Latest, true);
function isolated(names: string[], bindings: Record<string, unknown>) {
    const declarations = names.map(name => {
        const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
        assert.ok(declaration, name);
        return declaration.getText(ast).replace(/^export /, '');
    }).join('\n');
    const code = ts.transpileModule(declarations, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
    return vm.runInNewContext(`${code}; ({${names.join(',')}})`, { Api, Buffer, t, DEFAULT_LOCALE, ...bindings });
}

for (const locale of locales) {
    test(`${locale}: catalog preserves variables, literal commands, limits and safety warnings`, () => {
        assert.deepEqual(Object.keys(resources[locale]).sort(), Object.keys(resources['zh-CN']).sort());
        for (const [key, value] of Object.entries(resources[locale])) {
            assert.deepEqual(placeholders(value), placeholders(resources['zh-CN'][key as keyof typeof resources['zh-CN']]), `${locale}:${key}`);
            assert.doesNotMatch(value, /\\n|\\`/, `${locale}:${key}`);
            assert.doesNotMatch(value, /完整能力|四个主入口|双重保护|一站式|闭环|可靠上传|安全上传|remaining files will not be lost/i, key);
        }
        const cooldown = t(locale, 'channels.storageCooldown', { retryAt: '2040-01-02T03:04:05Z', jobId: 'sentinel-task-42' });
        assert.ok(cooldown.includes('2040-01-02T03:04:05Z'));
        assert.ok(cooldown.includes('sentinel-task-42'));
        assert.match(cooldown, /自动继续|resume automatically|возобновится автоматически/);
        assert.match(cooldown, /无需手动|no manual|Ручное возобновление не требуется/);
        assert.match(buildAuthSuccess(locale), /2 (?:GB|ГБ)/);
        assert.match(buildAuthSuccess(locale), /账号下载器不受此限制|account downloads are not subject|лимит не относится/);
        assert.match(t(locale, 'commands.auto022'), /10/);
        assert.match(t(locale, 'commands.auto022'), /每小时|hourly|час/i);
        assert.match(t(locale, 'commands.fileIdTooShort'), /8/);
        assert.match(t(locale, 'path.error.tooLong'), /180/);
        assert.match(t(locale, 'commands.fileSignedLink', { link: 'https://example.com/signed?token=sentinel' }), /https:\/\/example\.com\/signed\?token=sentinel/);
        assert.match(t(locale, 'commands.auto132'), /账号|account|аккаунт/i);
        assert.match(t(locale, 'channels.errors.sourceAllowlistRequired'), /TELEGRAM_ALLOWED_SOURCES/);
        for (const key of ['commands.cleanupConfirmImpact', 'commands.bulkWarning', 'taskCenter.cancel.activeWarning', 'bot.subscription.confirmBody']) {
            assert.match(t(locale, key), /删除|清理|临时|停止|delete|removes|clean|stop|abort|удал|очист|остан|прерв/i, key);
        }
    });

    test(`${locale}: actual upload receipts preserve filenames, target, size, IDs and failure details`, () => {
        const text = buildUploadSuccess('sentinel-file.pdf', 2048, 'document', 'local', 'sentinel/folder', '12345678-1234-1234-1234-123456789012', null, locale);
        for (const value of ['sentinel-file.pdf', '2 KB', 'sentinel/folder', '12345678-1234-1234-1234-123456789012'.slice(0, 13)]) assert.ok(text.includes(value), value);
        const failed = buildUploadFail('sentinel-file.pdf', 'sentinel upstream error 429', locale);
        assert.ok(failed.includes('sentinel-file.pdf'));
        assert.ok(failed.includes('sentinel upstream error 429'));
        assert.ok(failed.includes('/download_workers'));
    });

    test(`${locale}: confirmation and progress labels retain task IDs and callback payloads`, () => {
        const item = { sourceType: 'memory', id: 's-sentinel-42', kind: 'single', title: 'sentinel-file.pdf', state: 'running', total: 7, active: 1, pending: 4, completed: 2, failed: 0, skipped: 0, createdAt: 1, updatedAt: 1 } as TaskCenterItem;
        const confirmation = buildTaskCancelConfirm(item, 3, locale);
        assert.ok(confirmation.text.includes('sentinel-file.pdf'));
        assert.ok(confirmation.text.includes('2/7'));
        assert.ok(confirmation.text.includes(t(locale, 'taskCenter.cancel.activeWarning')));
        assert.ok(confirmation.text.includes(t(locale, 'taskCenter.cancel.unaffected')));
        assert.deepEqual(parseTaskCenterCallback(confirmation.rows[0][0].data), { view: 'action', action: 'cancel_confirm', sourceType: 'memory', id: item.id, page: 3 });
        const controls = buildTaskControlButtons(item.id, false, undefined, false, false, 2, locale)!;
        const callbacks = controls.rows.flatMap(row => row.buttons.map(button => (button as Api.KeyboardButtonCallback).data.toString()));
        assert.deepEqual(callbacks, ['tq_pause_s-sentinel-42', 'tq_cancel_s-sentinel-42', 'receipt_retry_s-sentinel-42', 'receipt_failures_s-sentinel-42']);
        assert.ok(controls.rows[1].buttons[0].text.includes('2'));
        assert.equal(controls.rows[0].buttons[0].text, t(locale, 'task.pause'));
    });

    test(`${locale}: actual worker warning edit preserves high-concurrency confirmation without writing settings`, async () => {
        const edits: any[] = [], answers: any[] = [];
        const { handleDownloadWorkersCallback, buildDownloadWorkersKeyboard } = isolated(['handleDownloadWorkersCallback', 'buildDownloadWorkersKeyboard'], {
            getTelegramUserLocaleOrDefault: async () => locale,
            isAuthenticatedAsync: async () => true,
            DOWNLOAD_WORKER_OPTIONS: [4, 8, 12, 16],
            setSetting: async () => { assert.fail('warning must not change settings'); },
        });
        await handleDownloadWorkersCallback({ editMessage: async (_: unknown, payload: any) => edits.push(payload), invoke: async (payload: any) => answers.push(payload) }, { userId: { toJSNumber: () => 42 }, peer: 'sentinel-chat', msgId: 17, queryId: 19n }, 'dw_set_16');
        assert.equal(edits.length, 1);
        assert.ok(edits[0].text.includes('16'));
        assert.ok(edits[0].text.includes(t(locale, 'commands.auto130')));
        assert.ok(edits[0].text.includes(t(locale, 'commands.auto131')));
        assert.ok(edits[0].text.includes(t(locale, 'commands.auto133')));
        assert.equal(edits[0].message, 17);
        assert.deepEqual(Array.from(edits[0].buttons.rows.flatMap((row: any) => row.buttons.map((button: any) => button.data.toString()))), ['dw_confirm_16', 'dw_cancel']);
        assert.equal(JSON.stringify(edits[0].buttons), JSON.stringify(buildDownloadWorkersKeyboard(16, 16, locale)));
        assert.equal(answers[0].message, t(locale, 'commands.secondConfirm'));
    });
}

test('Russian instructions preserve actual accepted command tokens', () => {
    for (const [key, token] of [['bot.legacy.usageDate', '/tg_date'], ['bot.wizard.confirmInput', 'confirm'], ['bot.wizard.invalidMode', 'date'], ['bot.wizard.invalidMode', 'tag'], ['bot.wizard.invalidComments', 'on'], ['bot.wizard.invalidComments', 'off'], ['notifications.error.successMode', 'immediate'], ['notifications.error.successMode', 'digest'], ['notifications.error.successMode', 'off'], ['notifications.error.quietFormat', 'quiet off']]) {
        assert.ok(t('ru', key).includes(token), `${key}: ${token}`);
    }
});

test('command menu keeps stable command IDs and neutral authentication scope', () => {
    for (const locale of locales) {
        assert.deepEqual(buildBotCommandMenu(locale).map(item => item.command), BOT_COMMANDS.filter(item => item.menu).map(item => item.command));
    }
    assert.match(BOT_COMMANDS.find(item => item.command === 'logout')!.description, /当前 Telegram 用户/);
    assert.match(BOT_COMMANDS.find(item => item.command === 'language')!.helpDescription, /Русский/);
    assert.doesNotMatch(Object.values(MSG).join('\n'), /双重保护|安全上传|完整能力/);
});

test('legacy summaries retain completion and cleanup data without cloud-safety promises', async () => {
    const success = await buildConsolidatedStatus([{ fileName: 'sentinel-file.pdf', typeEmoji: '📄', phase: 'success', size: 2048, providerName: 'local', folder: 'sentinel/folder' }], []);
    for (const value of ['sentinel/folder', '2 KB', '成功: 1', '/list']) assert.ok(success.includes(value), value);
    assert.doesNotMatch(success, /安全上传|云端！/);
    const failed = await buildConsolidatedStatus([{ fileName: 'sentinel-file.pdf', typeEmoji: '📄', phase: 'failed', error: 'sentinel failure' }], []);
    assert.ok(failed.includes('失败: 1'));
    assert.ok(failed.includes('临时文件不会在这里自动删除'));
    assert.ok(failed.includes('确认文件状态'));
    const active = await buildConsolidatedStatus([{ fileName: 'sentinel-file.pdf', typeEmoji: '📄', phase: 'failed', error: 'sentinel failure' }, { fileName: 'queued.pdf', typeEmoji: '📄', phase: 'queued' }], []);
    assert.ok(active.includes('sentinel-file.pdf'));
    assert.ok(active.includes('sentinel failure'));
    const cleanup = buildCleanupNotice(17, '3 GB');
    assert.ok(cleanup.includes('17'));
    assert.ok(cleanup.includes('3 GB'));
    assert.doesNotMatch(cleanup, /这些是之前上传失败/);
    const batch = buildBatchStatus({ files: [{ fileName: 'a.pdf', mimeType: 'application/pdf', status: 'success', size: 2048 }], folderName: 'sentinel batch', folderPath: 'sentinel/folder', providerName: 'local', queuePending: 0, queueActive: 0 });
    for (const value of ['sentinel batch', 'sentinel/folder', '1/1', '2 KB']) assert.ok(batch.includes(value), value);
});
