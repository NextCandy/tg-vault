import assert from 'node:assert/strict';
import test from 'node:test';
import { DownloadSpeedSampler, downloadProgressView } from './downloadProgress.js';
import { DownloadTaskQueue } from './downloadTaskQueue.js';
import { mapTransferTask } from './unifiedTaskMapper.js';
import { buildDownloadProgress } from '../utils/telegramMessages.js';

test('speed sampler samples elapsed bytes and clears retries and stalls', () => {
    const sampler = new DownloadSpeedSampler(0);
    sampler.update(2048, 1000);
    assert.equal(sampler.speed(1000), 2048);
    assert.equal(sampler.speed(11000), 0);
    sampler.update(0, 12000);
    assert.equal(sampler.speed(12000), 0);
    sampler.update(1024, 13000);
    assert.equal(sampler.speed(13000), 1024);
    sampler.reset(14000);
    assert.equal(sampler.speed(14000), 0);
});

test('queue, API and Bot agree on in-flight bytes instead of completed item counts', async () => {
    const snapshots: import('./downloadTaskQueue.js').DownloadTaskGroupSnapshot[] = [];
    const queue = new DownloadTaskQueue({ maxConcurrent: 1, onGroupChanged: snapshot => { snapshots.push(snapshot); } });
    queue.ensureGroup({ id: 'progress', kind: 'single', title: 'test.bin', chatId: 'test', expectedTotal: 1 });
    let release!: () => void;
    let taskId!: string;
    const work = queue.add('progress', 'test.bin', async (_signal, id) => {
        taskId = id!;
        await new Promise<void>(resolve => { release = resolve; });
    }, 10000);
    await new Promise(resolve => setTimeout(resolve, 0));
    queue.updateProgress(taskId, 2700, 10000);
    const live = queue.getGroup('progress')!;
    assert.equal(live.completed, 0);
    assert.equal(live.completedBytes, 2700);
    assert.equal(live.totalBytes, 10000);
    const mapped = mapTransferTask({ id: 'progress', sourceType: 'telegram_bot', status: 'running', progress: 0, payload: {}, totalItems: 1 } as any, new Map(), live);
    assert.equal(mapped.progress, 27);
    assert.deepEqual(mapped.bytes, { total: 10000, transferred: 2700 });
    assert.equal(mapped.detail.speedBytesPerSecond, live.speedBytesPerSecond);
    for (const locale of ['zh-CN', 'en', 'ru'] as const) {
        const text = buildDownloadProgress('test.bin', live.completedBytes!, live.totalBytes!, '📄', undefined, locale, 2048);
        assert.match(text, /27%/);
        assert.match(text, /\/s/);
    }
    queue.resetProgress(taskId);
    assert.equal(queue.getGroup('progress')!.completedBytes, 0);
    queue.updateProgress(taskId, 10000, 10000);
    release();
    await work;
    await new Promise(resolve => setTimeout(resolve, 0));
    const done = snapshots.slice().reverse().find(snapshot => snapshot.state === 'completed')!;
    assert.equal(done.completedBytes, 10000);
    assert.equal(done.totalBytes, 10000);
    assert.equal(done.speedBytesPerSecond, 0);
});

test('unknown totals preserve item percentage and stale persisted speeds clear', () => {
    assert.equal(downloadProgressView({ completedBytes: 200, totalBytes: 1000, byteProgressKnown: false }, true, 25).percent, 25);
    assert.equal(downloadProgressView({ speedBytesPerSecond: 2048, speedUpdatedAt: 0 }, true, 0, 11000).speedBytesPerSecond, 0);
    assert.equal(downloadProgressView({ speedBytesPerSecond: 2048, speedUpdatedAt: 1000 }, false, 0, 1001).speedBytesPerSecond, 0);
});
