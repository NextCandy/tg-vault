import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { Api } from 'telegram';
import { t, DEFAULT_LOCALE } from '../i18n/telegram.js';
import { MSG, buildAuthSuccess } from '../utils/telegramMessages.js';
const buildBotStartKeyboard = (locale: string) => run('buildBotStartKeyboard', {})(locale);

const source = fs.readFileSync(new URL('./telegramBot.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('bot.ts', source, ts.ScriptTarget.Latest, true);
function run(name: string, bindings: any) {
    const declaration = ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === name)!;
    assert.ok(declaration, name);
    const code = ts.transpileModule(declaration.getText(ast).replace(/^export /, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    return vm.runInNewContext(`${code}; ${name}`, { Api, Buffer, t, DEFAULT_LOCALE, MSG, buildAuthSuccess, buildBotStartKeyboard, console, ...bindings });
}
function passwordHarness(locale: string, overrides: any = {}) {
    const edits: any[] = [], answers: any[] = [], persisted: number[] = [];
    const passwords = new Map(), states = new Map();
    const bindings = {
        client: { editMessage: async (_: any, p: any) => edits.push(p), invoke: async (p: any) => answers.push(p) },
        getTelegramUserLocaleOrDefault: async () => locale, getPinLockSeconds: () => 0,
        passwordInputState: passwords, userStates: states, TELEGRAM_PIN_REQUIRED_LENGTH: 4,
        TelegramUserState: { WAITING_2FA_LOGIN: 'login' }, verifyTelegramPin: async () => true,
        recordPinFailure: () => ({ locked: false }), getConfiguredTelegramAllowedUsers: async () => [42],
        canTelegramUserAuthenticate: (id: number, ids: number[]) => ids.includes(id), countAuthenticatedTelegramUsers: async () => 1,
        shouldAutoAllowFirstTelegramUser: () => false, is2FAEnabled: async () => false,
        persistAuthenticatedUser: async (id: number) => persisted.push(id),
        generatePasswordKeyboard: run('generatePasswordKeyboard', {}), ...overrides,
    };
    const handler = run('handlePasswordCallback', bindings);
    return { edits, answers, persisted, passwords, states, press: (key: string) => handler({ userId: { toJSNumber: () => 42 }, data: Buffer.from(`pwd_${key}`), peer: 'peer', msgId: 7, queryId: 1 }) };
}
for (const locale of ['zh-CN', 'en', 'ru'] as const) {
    test(`PIN edits and successful home controls stay localized: ${locale}`, async () => {
        const h = passwordHarness(locale);
        await h.press('1');
        assert.equal(h.edits[0].text, t(locale, 'auth.inputPrompt'));
        assert.equal(h.edits[0].buttons.rows[4].buttons[0].text, t(locale, 'keyboard.cancel'));
        for (const digit of ['2', '3', '4']) await h.press(digit);
        assert.deepEqual(h.persisted, [42]);
        assert.equal(h.edits.at(-1).text, buildAuthSuccess(locale));
        assert.equal(JSON.stringify(h.edits.at(-1).buttons), JSON.stringify(buildBotStartKeyboard(locale)));
    });
    test(`wrong PIN and 2FA prompt cannot expose home controls: ${locale}`, async () => {
        const wrong = passwordHarness(locale, { verifyTelegramPin: async () => false });
        for (const digit of ['1', '2', '3', '4']) await wrong.press(digit);
        assert.equal(wrong.edits.at(-1).text, t(locale, 'auth.wrong'));
        assert.equal(wrong.edits.at(-1).buttons.rows[4].buttons[0].text, t(locale, 'keyboard.cancel'));
        assert.equal(wrong.persisted.length, 0);
        const two = passwordHarness(locale, { is2FAEnabled: async () => true });
        for (const digit of ['1', '2', '3', '4']) await two.press(digit);
        assert.equal(two.edits.at(-1).text, t(locale, 'auth.twoFactorPrompt'));
        assert.equal(two.edits.at(-1).buttons, undefined);
        assert.equal(two.persisted.length, 0);
        assert.equal(two.states.get(42).state, 'login');
    });
    test(`actual 2FA completion returns home and deletes secrets: ${locale}`, async () => {
        const start = source.indexOf('const userState = userStates.get(senderId);');
        const end = source.indexOf('// File Handling', start);
        const code = ts.transpileModule(`async function handle() { ${source.slice(start, end)} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
        for (const state of ['login', 'setup']) {
            const replies: any[] = [], deletions: any[] = [], persisted: any[] = [];
            const userStates = new Map([[42, { state, promptMessageId: 7, qrMessageId: 8 }]]);
            const handle = vm.runInNewContext(`${code}; handle`, {
                senderId: 42, userStates, TelegramUserState: { WAITING_2FA_LOGIN: 'login', WAITING_2FA_SETUP: 'setup' },
                text: '123 456', verifyTOTP: async () => true, isAuthenticatedAsync: async () => true,
                activate2FA: async () => {}, persistAuthenticatedUser: async (id: number) => persisted.push(id),
                message: { id: 9, reply: async (p: any) => replies.push(p) }, client: { deleteMessages: async (...args: any[]) => deletions.push(args) }, chatId: 'peer',
                getTelegramUserLocaleOrDefault: async () => locale, buildBotStartKeyboard, t, MSG, console,
            });
            await handle();
            assert.equal(replies[0].message, t(locale, state === 'login' ? 'auth.twoFactorLoginOk' : 'auth.twoFactorActivated'));
            assert.equal(JSON.stringify(replies[0].buttons), JSON.stringify(buildBotStartKeyboard(locale)));
            assert.equal(persisted.length, state === 'login' ? 1 : 0);
            assert.equal(JSON.stringify(deletions), JSON.stringify([['peer', [9, 8, 7], { revoke: true }]]));
            assert.equal(userStates.size, 0);
        }
    });
}
test('wizard cancellation accepts advertised Russian text and /cancel without changing other scopes', async () => {
    const isCancelInput = run('isCancelInput', {});
    for (const input of ['Отмена', ' ОТМЕНА ', '/cancel', 'cancel', '取消']) {
        const removed: any[] = [], replies: any[] = [];
        const handler = run('handleTelegramWizardMessage', {
            getTelegramUserLocaleOrDefault: async () => 'ru', messageChatKey: () => 'peer', isCancelInput,
            telegramWizardStates: { lookup: () => ({ status: 'found', record: { value: { kind: 'tg_sub_manage', step: 'source' } } }), delete: (...args: any[]) => removed.push(args) },
            refreshTelegramWizardState: () => {},
        });
        await handler({ reply: async (p: any) => replies.push(p) }, 42, input);
        assert.equal(JSON.stringify(removed), JSON.stringify([[42, 'peer']]));
        assert.equal(replies[0].message, t('ru', 'bot.wizard.cancelled'));
    }
    assert.equal(isCancelInput('cancel/channel'), false);
});

test('new subscription completion retains source, cursor and localized return control', async () => {
    for (const locale of ['zh-CN', 'en', 'ru'] as const) {
        const replies: any[] = [];
        const state = { kind: 'tg_sub_manage', step: 'path', source: '@example' };
        const handler = run('handleTelegramWizardMessage', {
            getTelegramUserLocaleOrDefault: async () => locale, messageChatKey: () => 'peer',
            telegramWizardStates: { lookup: () => ({ status: 'found', record: { value: state } }), delete: (id: number, chat: string) => { assert.equal(id, 42); assert.equal(chat, 'peer'); } },
            refreshTelegramWizardState: () => {}, isCancelInput: () => false,
            subscribeTelegramChannel: async (id: number, chat: string, source: string) => {
                assert.equal(id, 42); assert.equal(chat, 'peer'); assert.equal(source, '@example');
                return { title: 'Channel title', source: '@example', last_message_id: 1234 };
            },
        });
        await handler({ chatId: 'peer', reply: async (p: any) => replies.push(p) }, 42, 'skip');
        for (const value of ['Channel title', '@example', '1234']) assert.ok(replies[0].message.includes(value));
        assert.equal(replies[0].buttons.rows[0].buttons[0].data.toString(), 'tsub_page_0');
        assert.equal(replies[0].buttons.rows[0].buttons[0].text, t(locale, 'bot.subscription.backButton'));
    }
});

test('from-now callback refreshes the displayed cursor with owner-scoped rows', async () => {
    const edits: any[] = [], owners: number[] = [];
    let cursor = 10;
    const handler = run('handleTelegramSubscriptionCallback', {
        client: { editMessage: async (_: any, p: any) => edits.push(p), invoke: async () => {} },
        getTelegramUserLocaleOrDefault: async () => 'en', isAuthenticatedAsync: async () => true,
        parseTelegramSubscriptionCallback: () => ({ kind: 'action', action: 'from_now', id: 'sub1', page: 2 }),
        listManageableTelegramSubscriptions: async (id: number) => { owners.push(id); return [{ id: 'sub1', last_message_id: cursor }]; },
        setTelegramSubscriptionFromNow: async (id: number, sub: string) => { assert.equal(id, 42); assert.equal(sub, 'sub1'); cursor = 99; },
        buildSubscriptionManagePanel: (rows: any[], page: number) => `${rows[0].last_message_id}/${page}`,
        buildSubscriptionActionKeyboard: () => 'controls',
    });
    await handler({ userId: { toJSNumber: () => 42 }, peer: 'peer', msgId: 7 }, 'tsub_from_now_sub1_2');
    assert.equal(edits[0]?.text, '99/2');
    assert.equal(edits[0]?.buttons, 'controls');
    assert.deepEqual(owners, [42, 42]);
});
