import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSubscriptionResultSummary, buildSubscriptionDisplayLines } from '../bot/presentation/subscription.js';
import { t, type TelegramLocale } from '../i18n/telegram.js';

for (const locale of ['zh-CN', 'en', 'ru'] as TelegramLocale[]) {
    test(`${locale}: subscription results show readable labels and counts, not backend JSON`, () => {
        const result = { status: 'partial', found: 12, failed: 3 };
        const summary = buildSubscriptionResultSummary(result, locale);
        assert.ok(summary.includes(t(locale, 'bot.subscription.result.partial')));
        assert.match(summary, /12/);
        assert.match(summary, /3/);
        assert.doesNotMatch(summary, /"(?:status|found|failed)"|[{}]/);
        assert.equal(buildSubscriptionResultSummary(null, locale), t(locale, 'bot.callback.noResult'));
        assert.ok(buildSubscriptionDisplayLines({ enabled: true, source: '@channel', last_result: result }, 0, locale).includes(summary));
    });
}

test('subscription callbacks use the summary instead of serializing internal records', () => {
    const source = readFileSync(new URL('./telegramBot.ts', import.meta.url), 'utf8');
    const callback = source.slice(source.indexOf('async function handleTelegramSubscriptionCallback'), source.indexOf('export async function initTelegramBot'));
    assert.match(callback, /buildSubscriptionResultSummary\(target\.last_result, locale\)/);
    assert.doesNotMatch(callback, /JSON\.stringify\(target\.last_result\)/);
    assert.doesNotMatch(callback, /message: '[\u4e00-\u9fff]/);
});
