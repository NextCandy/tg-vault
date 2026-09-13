import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, localStorage: dom.window.localStorage, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, MutationObserver: dom.window.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
const { cleanup, render, screen, fireEvent } = await import('@testing-library/react');
const { default: i18n } = await import('../../i18n');
const { LocalStorageLocation } = await import('./LocalStorageLocation');
const originalFetch = globalThis.fetch;
const fixture = { hostPath: '/srv/my files/uploads', pathStatus: 'verified', status: 'available', availableBytes: 1024 ** 3, totalBytes: 10 * 1024 ** 3, containerPath: '/data/uploads', mountType: 'bind' };
afterEach(() => { cleanup(); globalThis.fetch = originalFetch; });
after(() => {
    dom.window.close();
    for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete (globalThis as Record<string, unknown>)[name];
    }
});
test('all locales show one copyable host path and collapsed technical details', async () => {
    globalThis.fetch = async (url, init) => {
        assert.ok(String(url).endsWith('/storage/local-location'));
        assert.equal(init?.credentials, 'include');
        return Response.json(fixture);
    };
    let copied = '';
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { copied = text; } } });
    for (const locale of ['zh-CN', 'en', 'ru']) {
        await i18n.changeLanguage(locale);
        render(<LocalStorageLocation />);
        await screen.findByText(fixture.hostPath);
        assert.equal(document.querySelector('[data-local-storage-location] > p'), null);
        assert.ok(screen.getByText(i18n.t('localStorageLocation.capacityNote')).closest('details'));
        assert.ok(screen.getByText(i18n.t('localStorageLocation.mappingNote')).closest('details'));
        assert.equal(document.querySelector('details')?.open, false);
        fireEvent.click(screen.getByText(i18n.t('localStorageLocation.copy')));
        await screen.findByText(i18n.t('localStorageLocation.copied'));
        assert.equal(copied, fixture.hostPath);
        assert.equal(document.querySelectorAll('[data-host-storage-path]').length, 1);
        cleanup();
    }
});
test('unconfirmed path never offers a misleading container-path copy', async () => {
    globalThis.fetch = async () => Response.json({ ...fixture, hostPath: null, pathStatus: 'unconfirmed', status: 'read-only', availableBytes: null });
    render(<LocalStorageLocation />);
    await screen.findByText(i18n.t('localStorageLocation.unconfirmed'));
    assert.equal(document.querySelector('[data-host-storage-path]')?.textContent?.includes('/data'), false);
    assert.equal(screen.queryByText(i18n.t('localStorageLocation.copy')), null);
});
test('failed request can be retried', async () => {
    globalThis.fetch = async () => { throw new Error('offline'); };
    render(<LocalStorageLocation />);
    await screen.findByRole('alert');
    globalThis.fetch = async input => { assert.match(String(input), /\/api\/storage\/local-location$/); return Response.json(fixture); };
    fireEvent.click(screen.getByText(i18n.t('localStorageLocation.retry')));
    await screen.findByText(fixture.hostPath);
});
