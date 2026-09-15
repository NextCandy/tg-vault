// Bot-only lifecycle primitive. No user-account, storage or Telegram imports.
export interface BotClientLifecycle { destroy(): Promise<unknown> }
export class BotLifecycleError extends Error {
    constructor(public readonly code: string) { super(code); }
}
export class TelegramBotSupervisor {
    private tail: Promise<void> = Promise.resolve();
    private controller = new AbortController();
    private pending = 0;
    private blocked = false;
    private owned: { client: BotClientLifecycle; pending: Set<Promise<unknown>> } | null = null;
    constructor(private readonly timeoutMs = 10_000) {}
    get busy(): boolean { return this.pending > 0; }
    get cleanupBlocked(): boolean { return this.blocked; }
    cancel(): void { this.controller.abort(); }
    quarantine(): void { this.blocked = true; }
    assertActive(): void {
        if (this.controller.signal.aborted) throw new BotLifecycleError('BOT_CANCELLED');
        if (this.blocked) throw new BotLifecycleError('BOT_CLEANUP_UNCONFIRMED');
    }
    run<T>(operation: () => Promise<T>): Promise<T> {
        this.pending++;
        const result = this.tail.then(async () => {
            this.controller = new AbortController();
            return operation();
        });
        this.tail = result.then(() => undefined, () => undefined);
        return result.finally(() => { this.pending--; });
    }
    own(client: BotClientLifecycle): void {
        this.assertActive();
        if (this.owned) throw new BotLifecycleError('BOT_CLEANUP_UNCONFIRMED');
        this.owned = { client, pending: new Set() };
    }
    async operation<T>(work: () => Promise<T>, timeoutMs: number): Promise<T> {
        this.assertActive();
        const owner = this.owned;
        if (!owner) throw new BotLifecycleError('BOT_NO_CLIENT');
        const promise = Promise.resolve().then(work);
        owner.pending.add(promise);
        void promise.finally(() => owner.pending.delete(promise)).catch(() => undefined);
        const signal = this.controller.signal;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let abort: () => void = () => undefined;
        try {
            return await Promise.race([promise, new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new BotLifecycleError('BOT_STARTUP_TIMEOUT')), timeoutMs);
                abort = () => reject(new BotLifecycleError('BOT_CANCELLED'));
                signal.addEventListener('abort', abort, { once: true });
                if (signal.aborted) abort();
            })]);
        } finally {
            clearTimeout(timer);
            signal.removeEventListener('abort', abort);
        }
    }
    private async bounded(work: Promise<unknown>): Promise<void> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            await Promise.race([work, new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new BotLifecycleError('BOT_CLEANUP_UNCONFIRMED')), this.timeoutMs);
            })]);
        } finally { clearTimeout(timer); }
    }
    async cleanup(): Promise<void> {
        if (this.blocked) throw new BotLifecycleError('BOT_CLEANUP_UNCONFIRMED');
        const owner = this.owned;
        if (!owner) return;
        // A resolved destroy is NOT proof of cancellation of an in-flight start.
        // Await all outstanding RPC/start work, then destroy again. If either
        // cannot be confirmed, permanently quarantine this process's Bot lane.
        const cleanup = (async () => {
            try {
                await owner.client.destroy();
            } finally {
                // Even a failed first destroy must retain the late-start cleanup.
                // Its rejection still quarantines the lane after final cleanup.
                await Promise.allSettled([...owner.pending]);
                await owner.client.destroy();
            }
        })();
        try {
            await this.bounded(cleanup);
            this.owned = null;
        } catch {
            this.blocked = true;
            // A late start may reconnect even after destroy; the continuation
            // above destroys it again, but never permits a new authorization.
            void cleanup.catch(() => undefined);
            throw new BotLifecycleError('BOT_CLEANUP_UNCONFIRMED');
        }
    }
}

export function botRetryDelay(error: unknown, attempt: number, random = Math.random): number | null {
    const value = error as { message?: string; errorMessage?: string; seconds?: number };
    const message = `${value?.errorMessage || ''} ${value?.message || error}`;
    if (/BOT_CANCELLED|BOT_CLEANUP_UNCONFIRMED|AUTH|TOKEN|UNAUTHORIZED|FORBIDDEN|API_ID_INVALID|401|403/i.test(message)) return null;
    if (attempt >= 4) return null;
    if (/FLOOD|429/i.test(message)) {
        const seconds = Number(value?.seconds || message.match(/FLOOD_WAIT_?(\d+)/i)?.[1]);
        // Unknown or excessive server delay requires operator action, not guessing.
        return Number.isFinite(seconds) && seconds > 0 && seconds <= 86400 ? seconds * 1000 + 1000 : null;
    }
    if (!/TIMEOUT|TIMED? OUT|超时|ECONN|ETIMEDOUT|ENET|EHOST|EAI_AGAIN|NETWORK|CONNECTION|DISCONNECT|SOCKET|RPC_CALL_FAIL|INTERNAL|500|502|503/i.test(message)) return null;
    return Math.min(60_000, 5_000 * 2 ** Math.max(0, attempt - 1)) + Math.floor(random() * 2000);
}
