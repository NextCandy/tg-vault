import assert from 'node:assert/strict';
import { StorageQuotaCooldownError } from './storage.js';
import { buildStorageCooldownHttpError, formatStorageCooldownNotice } from './storageCooldownGuard.js';

async function main() {
    const cooldownUntil = new Date('2030-01-02T03:04:05.000Z');
    const error = new StorageQuotaCooldownError('Google Drive 今日上传额度已达上限，任务将自动暂停 24 小时后继续。', {
        provider: 'google_drive',
        reason: 'daily_upload_limit',
        storageAccountId: 'account-id',
        cooldownUntil,
    });

    const payload = buildStorageCooldownHttpError(error);
    assert.equal(payload.status, 429);
    assert.equal(payload.body.code, 'storage_account_cooling');
    assert.equal(payload.body.provider, 'google_drive');
    assert.equal(payload.body.reason, 'daily_upload_limit');
    assert.equal(payload.body.retryAt, cooldownUntil.toISOString());
    assert.match(payload.body.error, /Google Drive/);
    assert.match(payload.body.error, /24 小时/);

    const notice = formatStorageCooldownNotice(cooldownUntil);
    assert.match(notice, /Google Drive 今日上传额度已达上限/);
    assert.match(notice, /2030-01-02T03:04:05.000Z/);
    assert.match(notice, /任务已暂停/);
    assert.doesNotMatch(notice, /不会丢失/);
    assert.match(notice, /重新检查/);
    assert.match(notice, /限制已解除，将自动继续/);
    assert.match(notice, /否则会更新冷却时间/);

    console.log('storage cooldown guard formatting ok');
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
