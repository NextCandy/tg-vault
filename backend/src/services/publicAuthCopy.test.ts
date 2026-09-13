import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build2FASetupCaption } from '../utils/telegramMessages.js';

const bot = readFileSync(new URL('./telegramBot.ts', import.meta.url), 'utf8');
const commands = readFileSync(new URL('./telegramCommands.ts', import.meta.url), 'utf8');

test('authentication and 2FA instructions use the recipient language', () => {
    assert.doesNotMatch(bot, /MSG\.(AUTH_REQUIRED|AUTH_2FA_QR_FAIL|UNKNOWN_TEXT)/);
    assert.match(bot, /build2FASetupCaption\(messageLocale\)/);
    const texts = [build2FASetupCaption('zh-CN'), build2FASetupCaption('en'), build2FASetupCaption('ru')];
    assert.ok(texts.every(text => text.includes('6')));
    assert.match(texts[0], /请勿分享/);
    assert.match(texts[1], /Do not share/);
    assert.match(texts[2], /Не передавайте/);
    assert.doesNotMatch(texts[1] + texts[2], /[\u4e00-\u9fff]/);
});

test('high-concurrency confirmation retains risk labels in localized templates', () => {
    for (const key of ['auto132','auto138','auto139','auto140','auto141','auto142','auto143']) {
        assert.ok(commands.includes(`t(locale, 'commands.${key}')`));
    }
    assert.match(commands, /buildFileConcurrencyKeyboard\(concurrency, concurrency, locale\)/);
});
