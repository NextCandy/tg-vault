import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const bot = fs.readFileSync(new URL('./telegramBot.ts', import.meta.url), 'utf8');

test('2FA setup refuses to redisplay an enabled secret and always removes QR temp files', () => {
    const block = bot.slice(bot.indexOf("if (text === '/setup_2fa'"), bot.indexOf("if (text === '/help'"));
    assert.match(block, /await is2FAEnabled\(\)/);
    assert.match(block, /t\(messageLocale, 'bot\.auth\.twoFactorEnabled'\)/);
    assert.ok(block.indexOf('await is2FAEnabled()') < block.indexOf('generateOTPAuthUrl()'));
    assert.match(block, /finally/);
    assert.match(block, /unlinkSync/);
});
