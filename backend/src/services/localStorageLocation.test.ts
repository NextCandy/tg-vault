import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { localStorageLocation } from './localStorageLocation.js';

test('local location verifies identity and reports actual filesystem space without counting files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'local-location-'));
    try {
        await fs.mkdir(path.join(root, 'uploads'));
        const stat = await fs.stat(root);
        const env = { UPLOAD_DIR: path.join(root, 'uploads'), LOCAL_STORAGE_HOST_ROOT: '/disk/my files', LOCAL_STORAGE_CONTAINER_ROOT: root, LOCAL_STORAGE_DEVICE: String(stat.dev), LOCAL_STORAGE_INODE: String(stat.ino), LOCAL_STORAGE_MOUNT_TYPE: 'bind' };
        const info = await localStorageLocation(env);
        assert.equal(info.hostPath, '/disk/my files/uploads');
        assert.equal(info.pathStatus, 'verified');
        assert.equal(info.status, 'available');
        const space = await fs.statfs(root);
        assert.equal(info.totalBytes, space.blocks * space.bsize);
        assert.ok(info.availableBytes! > 0);
        assert.deepEqual(await fs.readdir(env.UPLOAD_DIR), []);
        for (const change of [ { LOCAL_STORAGE_INODE: '0' }, { LOCAL_STORAGE_DEVICE: '0' }, { LOCAL_STORAGE_HOST_ROOT: 'relative' }, { LOCAL_STORAGE_CONTAINER_ROOT: '/missing' } ]) {
            assert.equal((await localStorageLocation({ ...env, ...change })).hostPath, null);
        }
        assert.equal((await localStorageLocation({ UPLOAD_DIR: env.UPLOAD_DIR })).hostPath, null);
        await fs.symlink(root, path.join(root, 'alias'));
        assert.equal((await localStorageLocation({ ...env, UPLOAD_DIR: path.join(root, 'alias/uploads') })).hostPath, null);
        assert.equal((await localStorageLocation({ ...env, UPLOAD_DIR: '/missing/uploads' })).status, 'unavailable');
    } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('host location route is authenticated and never cacheable', async () => {
    const source = await fs.readFile(new URL('../routes/storage.ts', import.meta.url), 'utf8');
    assert.match(source, /router.get\('\/local-location', requireAuth,[\s\S]*?noStore\(res\)/);
});
