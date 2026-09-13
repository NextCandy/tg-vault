import type { UnifiedTask } from './apiTypes';
import { formatBytes } from './formatBytes';

/** Render server samples, never estimate transfer speed from browser polling. */
export function taskTransferDisplay(task: UnifiedTask) {
    const downloading = task.status === 'running' && task.stage === 'downloading';
    const sample = task.detail.speedBytesPerSecond;
    const speed = downloading && typeof sample === 'number' && Number.isFinite(sample) && sample >= 0
        ? `${formatBytes(sample)}/s`
        : task.status === 'running' && typeof task.detail.speed === 'string' ? task.detail.speed : null;
    const transferred = Number.isFinite(task.bytes.transferred) ? Math.max(0, task.bytes.transferred) : 0;
    const total = Number.isFinite(task.bytes.total) ? Math.max(0, task.bytes.total) : 0;
    return {
        speed,
        showBytes: total > 0 || transferred > 0 || downloading,
        transferred: formatBytes(transferred),
        total: total > 0 ? formatBytes(total) : '—',
    };
}
