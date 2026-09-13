/** Shared queue/Bot/API byte telemetry. Rates are sampled at >=1s, expire after 10s. */
export const DOWNLOAD_SPEED_STALE_MS = 10_000;
export function validBytes(value: number | undefined): number {
    return Number.isFinite(value) && value! > 0 ? value! : 0;
}
export class DownloadSpeedSampler {
    private bytes = 0;
    private at: number;
    private lastBytes = 0;
    private changedAt: number;
    private rate = 0;
    constructor(now: number) { this.at = this.changedAt = now; }
    update(bytes: number, now: number): void {
        bytes = validBytes(bytes);
        if (bytes < this.lastBytes || now < this.at) this.reset(now, bytes);
        if (bytes !== this.lastBytes) this.changedAt = now;
        this.lastBytes = bytes;
        if (now - this.at >= 1_000) {
            this.rate = Math.max(0, (bytes - this.bytes) * 1_000 / (now - this.at));
            this.bytes = bytes;
            this.at = now;
        }
    }
    reset(now: number, bytes = 0): void {
        this.bytes = this.lastBytes = bytes;
        this.at = this.changedAt = now;
        this.rate = 0;
    }
    speed(now: number): number {
        return now - this.changedAt >= DOWNLOAD_SPEED_STALE_MS ? 0 : validBytes(this.rate);
    }
}

export interface DownloadByteProgress {
    completedBytes?: number;
    totalBytes?: number;
    speedBytesPerSecond?: number;
    speedUpdatedAt?: number;
    byteProgressKnown?: boolean;
}

/** Item counts remain available; only complete byte-size coverage replaces their percentage. */
export function downloadProgressView(
    telemetry: DownloadByteProgress, running: boolean, fallbackPercent: number, now = Date.now(),
): { percent: number; completedBytes: number; totalBytes: number; speedBytesPerSecond: number } {
    const totalBytes = validBytes(telemetry.totalBytes);
    const completedBytes = validBytes(telemetry.completedBytes);
    const fresh = Number.isFinite(telemetry.speedUpdatedAt)
        && now >= telemetry.speedUpdatedAt! && now - telemetry.speedUpdatedAt! < DOWNLOAD_SPEED_STALE_MS;
    return {
        percent: telemetry.byteProgressKnown && totalBytes > 0
            ? Math.min(100, completedBytes / totalBytes * 100) : fallbackPercent,
        completedBytes, totalBytes,
        speedBytesPerSecond: running && fresh ? validBytes(telemetry.speedBytesPerSecond) : 0,
    };
}
