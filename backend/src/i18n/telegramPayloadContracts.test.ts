import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import vm from 'node:vm';
import { resources, t, type TelegramLocale } from './telegram.js';

function isolated(filename: string, name: string, bindings: Record<string, unknown>) {
    const source = ts.createSourceFile(filename, fs.readFileSync(new URL(filename, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
    const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.ok(declaration, `Missing production function ${name}`);
    const code = ts.transpileModule(declaration.getText(source).replace(/^export /, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
    return vm.runInNewContext(`${code}; ${name}`, bindings);
}

for (const locale of Object.keys(resources) as TelegramLocale[]) {
    test(`${locale}: update notification wrapper preserves the entire actual send payload`, async () => {
        const sent: any[] = [];
        const send = isolated('../services/telegramBot.ts', 'sendUpdateNotificationToUser', {
            t, client: { connected: true, sendMessage: async (...args: any[]) => sent.push(args) },
            getTelegramBotStatus: () => ({ status: 'ready' }), getTelegramUserLocaleOrDefault: async () => locale,
        });
        const body = '**Release v123**\n\n- Body detail\nhttps://example.com/release\n{literal}';
        await send(42, body);
        assert.equal(sent.length, 1);
        assert.equal(sent[0][0], 42);
        assert.equal(sent[0][1].message, body);
    });
    test(`${locale}: confirmation renders source, comment configuration and storage defaults`, () => {
        const render = isolated('../services/telegramBot.ts', 'buildTelegramWizardPrompt', { t, DEFAULT_LOCALE: locale });
        const text = render({ kind: 'tg_tag', step: 'confirm', source: '@sentinel_channel', tag: 'sentinel_tag', includeComments: true, commentsMaxPerPost: 37 }, locale);
        for (const value of ['@sentinel_channel', 'sentinel_tag', '37', t(locale, 'bot.wizard.storage.current'), t(locale, 'bot.wizard.storage.currentAccount'), t(locale, 'bot.wizard.folder.defaultValue')]) assert.ok(text.includes(value), value);
        assert.doesNotMatch(text, /missing Telegram translation|undefined/);
    });
    test(`${locale}: invalid paths return localized validation rather than missing-key errors`, () => {
        const sanitize = isolated('../utils/telegramPathSettings.ts', 'sanitizeCustomStoragePath', { t, DEFAULT_LOCALE: locale, normalizePathSegment: (value: string) => value === '?' ? '' : value });
        for (const [input, key] of [['', 'empty'], ['~private', 'illegalChars'], ['../private', 'dotSegments'], ['?', 'invalid'], ['a'.repeat(181), 'tooLong']]) {
            assert.throws(() => sanitize(input, locale), error => (error as Error).message === t(locale, `path.error.${key}`));
        }
    });
}

function files(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(dir, entry.name)) : entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path.join(dir, entry.name)] : []);
}

test('literal Telegram translation calls preserve supplied payloads and supply required placeholders', () => {
    const failures: string[] = [];
    for (const filename of files(new URL('..', import.meta.url).pathname)) {
        const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
        function visit(node: ts.Node) {
            if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't' && node.arguments[1] && ts.isStringLiteral(node.arguments[1])) {
                const key = node.arguments[1].text;
                const values = node.arguments[2];
                if (values && !ts.isObjectLiteralExpression(values)) return;
                if (values && values.properties.some(p => ts.isSpreadAssignment(p))) return;
                const supplied = new Set(values ? values.properties.flatMap(p => p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? [p.name.text] : []) : []);
                for (const [locale, dictionary] of Object.entries(resources)) {
                    const template = (dictionary as Record<string, string>)[key];
                    const at = `${path.relative(new URL('..', import.meta.url).pathname, filename)}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1} ${locale} ${key}`;
                    if (template === undefined) failures.push(`${at}: missing translation`);
                    else {
                        const required = new Set([...template.matchAll(/\{([A-Za-z0-9_]+)(?:\}|,\s*plural,)/g)].map(m => m[1]));
                        for (const name of supplied) if (!required.has(name)) failures.push(`${at}: discarded ${name}`);
                        for (const name of required) if (!supplied.has(name)) failures.push(`${at}: missing ${name}`);
                    }
                }
            }
            ts.forEachChild(node, visit);
        }
        visit(source);
    }
    assert.deepEqual(failures, []);
});
