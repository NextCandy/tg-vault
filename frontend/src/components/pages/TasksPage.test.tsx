import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
import { JSDOM } from 'jsdom';
import type { UnifiedTask } from '../../services/apiTypes';
import { taskTransferDisplay } from '../../services/taskTransferDisplay';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, localStorage: dom.window.localStorage, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, MutationObserver: dom.window.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
const { cleanup, render, screen } = await import('@testing-library/react');
const { default: i18n } = await import('../../i18n');
const { fileApi } = await import('../../services/api');
const { TasksPage } = await import('./TasksPage');
const originalGetTasks = fileApi.getTasks;
const task: UnifiedTask = {
    id: 'transfer-test', sourceType: 'telegram_bot', kind: 'single', title: 'transfer.bin',
    status: 'running', stage: 'downloading', progress: 27, ownerUserId: null, chatId: null, source: null,
    target: { provider: 'local', accountId: null, accountName: null, folder: '/' },
    counts: { total: 1, completed: 0, failed: 0 }, bytes: { transferred: 281 * 1024 * 1024, total: 1024 ** 3 },
    detail: { speedBytesPerSecond: 2 * 1024 * 1024 }, error: null, retryable: false, cancellable: true, dismissible: false,
    createdAt: '2026-09-13T10:00:00Z', updatedAt: '2026-09-13T10:00:03Z', finishedAt: null,
};
afterEach(() => { cleanup(); fileApi.getTasks = originalGetTasks; });
after(() => {
    dom.window.close();
    for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete (globalThis as Record<string, unknown>)[name];
    }
});

test('task center renders byte progress, size and sampled speed in all locales', async () => {
    fileApi.getTasks = async () => ({ tasks: [task], total: 1, returned: 1, generatedAt: task.updatedAt });
    for (const language of ['zh-CN', 'en', 'ru']) {
        await i18n.changeLanguage(language);
        render(<TasksPage />);
        await screen.findByText('transfer.bin');
        assert.ok(screen.getByText('27%'));
        const display = taskTransferDisplay(task);
        assert.ok(screen.getByText(i18n.t('tasks.progress.speed', { speed: display.speed })));
        assert.ok(screen.getByText(i18n.t('tasks.progress.data', { transferred: display.transferred, total: display.total })));
        assert.ok(screen.getByText(i18n.t('tasks.progress.items', { completed: 0, total: 1 })));
        cleanup();
    }
});

test('unknown file size is not presented as a zero-byte file', () => {
    const display = taskTransferDisplay({ ...task, bytes: { total: 0, transferred: 4096 } });
    assert.equal(display.showBytes, true);
    assert.equal(display.total, '—');
});

test('terminal or saving tasks never retain sampled download speed', () => {
    for (const status of ['paused', 'completed', 'failed', 'cancelled']) {
        assert.equal(taskTransferDisplay({ ...task, status }).speed, null);
    }
    assert.equal(taskTransferDisplay({ ...task, stage: 'processing' }).speed, null);
});

test('invalid speeds are hidden while a genuine zero sample is shown', () => {
    for (const speedBytesPerSecond of [-1, Infinity, NaN]) {
        assert.equal(taskTransferDisplay({ ...task, detail: { speedBytesPerSecond } }).speed, null);
    }
    assert.equal(taskTransferDisplay({ ...task, detail: { speedBytesPerSecond: 0 } }).speed, '0 B/s');
});
