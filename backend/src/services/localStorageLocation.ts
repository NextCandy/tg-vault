import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export interface LocalStorageLocation {
    hostPath: string | null;
    pathStatus: 'verified' | 'unconfirmed';
    status: 'available' | 'read-only' | 'unavailable';
    availableBytes: number | null;
    totalBytes: number | null;
    containerPath: string;
    mountType: string | null;
}

// Deployment metadata is supplied by the host installer, never by API clients.
// Matching device + inode and canonical descendants rejects stale declarations,
// symlinks outside the mount and nested mounts. No Docker socket is exposed.
export async function localStorageLocation(env: NodeJS.ProcessEnv = process.env): Promise<LocalStorageLocation> {
    const containerPath = path.resolve(env.UPLOAD_DIR || './data/uploads');
    const result: LocalStorageLocation = {
        hostPath: null, pathStatus: 'unconfirmed', status: 'unavailable',
        availableBytes: null, totalBytes: null, containerPath, mountType: null,
    };
    let real: string;
    try {
        real = await fs.realpath(containerPath);
        const stat = await fs.stat(real);
        if (!stat.isDirectory()) return result;
        const space = await fs.statfs(real);
        result.availableBytes = space.bavail * space.bsize;
        result.totalBytes = space.blocks * space.bsize;
        await fs.access(real, fs.constants.R_OK);
        result.status = 'read-only';
        const probe = path.join(real, `.tg-vault-probe-${randomUUID()}`);
        let file;
        try {
            file = await fs.open(probe, 'wx', 0o600);
            await file.writeFile('ok');
            if (await fs.readFile(probe, 'utf8') === 'ok') result.status = 'available';
        } finally {
            if (file) { await file.close(); await fs.unlink(probe); }
        }
    } catch { return result; }
    try {
        const host = env.LOCAL_STORAGE_HOST_ROOT || '';
        const root = env.LOCAL_STORAGE_CONTAINER_ROOT || '';
        if (!path.isAbsolute(host) || !path.isAbsolute(root) || /[\x00-\x1f\x7f]/.test(host)) return result;
        const canonicalRoot = await fs.realpath(root);
        if (canonicalRoot !== path.resolve(root)) return result;
        const rootStat = await fs.stat(root);
        const uploadStat = await fs.stat(real!);
        const relative = path.relative(canonicalRoot, real!);
        if (relative.startsWith('..') || path.isAbsolute(relative) || real! !== containerPath) return result;
        if (String(rootStat.dev) !== env.LOCAL_STORAGE_DEVICE || String(rootStat.ino) !== env.LOCAL_STORAGE_INODE || uploadStat.dev !== rootStat.dev) return result;
        result.hostPath = path.join(host, relative);
        result.pathStatus = 'verified';
        result.mountType = ['bind', 'volume'].includes(env.LOCAL_STORAGE_MOUNT_TYPE || '') ? env.LOCAL_STORAGE_MOUNT_TYPE! : null;
    } catch { /* Missing/stale deployment metadata must not invent a host path. */ }
    return result;
}
