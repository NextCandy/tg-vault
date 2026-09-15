// Process-start recovery is independent of Bot readiness/retries. Required Bot
// failure blocks HTTP readiness, not this one-time recovery of enabled users.
export function createInitialTelegramRecovery(restore: () => Promise<void>) {
    let scheduled: Promise<void> | null = null;
    return (delayMs: number): Promise<void> => {
        if (!scheduled) scheduled = new Promise<void>(resolve => {
            const timer = setTimeout(resolve, delayMs);
            timer.unref?.();
        }).then(restore);
        return scheduled;
    };
}
