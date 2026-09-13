import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./SettingsPage.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');
const nav = source.slice(source.indexOf('<nav'), source.indexOf('</nav>'));

test('settings tabs stay one horizontally scrollable row on phones', () => {
    assert.match(nav, /flex-nowrap/);
    assert.match(nav, /overflow-x-auto/);
    assert.match(nav, /shrink-0 whitespace-nowrap/);
    assert.doesNotMatch(nav, /flex-wrap(?:\s|")|max-\[420px\]:flex-1/);
});

test('settings tabs stay in document flow and scroll out of view', () => {
    assert.doesNotMatch(nav, /\b(?:sticky|fixed)\b/);
});

test('Russian settings tabs override the global wrapping rule', () => {
    assert.match(css, /html\[lang="ru"\] \[data-testid="settings-tabs"\] button,[\s\S]*?white-space: nowrap !important/);
});
