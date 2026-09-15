import { createRequire } from 'node:module';
import { TelegramClient, Api } from 'telegram';
import { LAYER } from 'telegram/tl/AllTLObjects.js';

const require = createRequire(import.meta.url);
const SUPPORTED_VERSION = '2.26.22';

/** Instance-only GramJS compatibility boundary. Never install on user clients.
 * See BOT_RETRY_API.md before changing the SDK version or private hooks.
 */
export function ownBotTransport<T extends TelegramClient>(client: T): T {
    const c = client as any; // Private SDK surface intentionally confined here.
    if (require('telegram/package.json').version !== SUPPORTED_VERSION || c._sender !== undefined ||
        !(c._exportedSenderPromises instanceof Map) ||
        !['connect', 'destroy', '_createExportedSender', '_connectSender', '_borrowExportedSender', '_switchDC', 'invoke'].every(k => typeof c[k] === 'function')) {
        throw new Error('BOT_SDK_OWNERSHIP_UNSUPPORTED');
    }
    let closed = false, failed = false, startup = true, connectAllowed = true;
    let main: any;
    const senders = new Set<any>();
    const pending = new Set<Promise<any>>();
    const assertActive = () => {
        if (closed) throw new Error('BOT_CANCELLED');
        if (failed) throw new Error('BOT_CONNECTION_LOST');
    };
    const track = <R>(work: () => Promise<R>): Promise<R> => {
        const p = Promise.resolve().then(work);
        pending.add(p);
        void p.finally(() => pending.delete(p)).catch(() => undefined);
        return p;
    };
    const lost = () => { failed = true; };
    const protect = (sender: any) => {
        assertActive();
        if (senders.has(sender)) return sender;
        if (!['connect', '_connect', 'reconnect', '_reconnect', 'isConnected', 'send', 'addStateToQueue'].every(k => typeof sender[k] === 'function')) {
            failed = true;
            throw new Error('BOT_SDK_OWNERSHIP_UNSUPPORTED');
        }
        senders.add(sender);
        let used = false;
        const connect = sender.connect.bind(sender);
        const authKey = sender._authKeyCallback;
        sender._authKeyCallback = async (...args: any[]) => {
            assertActive();
            if (authKey) await authKey(...args);
            assertActive();
        };
        // Both SDK entry points matter: exported release uses _reconnect directly.
        sender._handleBadAuthKey = lost;
        sender._autoReconnectCallback = async () => { lost(); };
        sender.reconnect = lost;
        sender._reconnect = async () => { lost(); };
        sender.isConnected = () => !closed && !failed && !sender.isConnecting &&
            !sender.isReconnecting && !!sender._userConnected && !!sender._connection?.isConnected();
        sender.connect = (connection: any, force: boolean) => track(async () => {
            assertActive();
            if (used || force) { lost(); assertActive(); }
            used = true;
            // A socket can finish opening AFTER destroy. Close it before the SDK
            // can generate an auth key or start its send/receive loops.
            // Gate Connection._connect before its public connect starts socket loops.
            // Also gate public connect for injected/alternative transports.
            if (typeof connection._connect === 'function') {
                const openSocket = connection._connect.bind(connection);
                connection._connect = async (...args: any[]) => {
                    assertActive();
                    await openSocket(...args);
                    if (closed || failed) {
                        await connection.socket.close();
                        assertActive();
                    }
                };
            }
            const open = connection.connect.bind(connection);
            connection.connect = async () => {
                assertActive();
                await open();
                if (closed || failed) { await connection.disconnect(); assertActive(); }
            };
            sender._retries = 1;
            const ok = await connect(connection, false);
            assertActive();
            if (!ok) { lost(); throw new Error('BOT_CONNECTION_FAILED'); }
            return ok;
        });
        const send = sender.send.bind(sender);
        sender.send = (request: any) => { try { assertActive(); return send(request); } catch (e) { return Promise.reject(e); } };
        const enqueue = sender.addStateToQueue.bind(sender);
        sender.addStateToQueue = (state: any) => { assertActive(); return enqueue(state); };
        return sender;
    };
    // GramJS constructs its main sender after awaiting session initialization,
    // including during DC migration. Intercept assignment BEFORE connect runs.
    Object.defineProperty(c, '_sender', { configurable: false, get: () => main,
        set: value => { main = value === undefined ? undefined : protect(value); } });
    const createSender = c._createExportedSender.bind(c);
    c._createExportedSender = (dc: number) => { assertActive(); return protect(createSender(dc)); };
    const connect = c.connect.bind(c);
    c.connect = () => track(async () => {
        assertActive();
        if (!connectAllowed) { lost(); assertActive(); }
        connectAllowed = false;
        return connect();
    });
    const switchDC = c._switchDC.bind(c);
    c._switchDC = (dc: number) => track(async () => {
        assertActive();
        // Token login may legitimately migrate DC inside the owned startup.
        // Runtime migrations/reconnects must create a new supervisor attempt.
        if (!startup) { lost(); assertActive(); }
        connectAllowed = true;
        return switchDC(dc);
    });
    const start = c.start.bind(c);
    c.start = (...args: any[]) => track(async () => {
        assertActive();
        try { return await start(...args); } finally { startup = false; }
    });
    const invoke = c.invoke.bind(c);
    c.invoke = (...args: any[]) => { assertActive(); return invoke(...args); };
    // Replace GramJS's unbounded exported connect/borrow retry loops and release
    // timers. Retain each exported sender for this Bot attempt's lifetime.
    c._connectSender = (sender: any, dcId: number) => track(async () => {
        assertActive(); protect(sender);
        const dc = await c.getDC(dcId, !!sender.authKey.getKey());
        assertActive();
        await sender.connect(new c._connection({ ip: dc.ipAddress, port: dc.port, dcId,
            loggers: c._log, proxy: c._proxy, testServers: c.testServers, socket: c.networkSocket }), false);
        assertActive();
        if (c.session.dcId !== dcId && !sender._authenticated) {
            const auth = await c.invoke(new Api.auth.ExportAuthorization({ dcId }));
            assertActive();
            // Do not mutate the main client's shared init request.
            const init = new Api.InitConnection({ ...c._initRequest,
                query: new Api.auth.ImportAuthorization({ id: auth.id, bytes: auth.bytes }) });
            await sender.send(new Api.InvokeWithLayer({ layer: LAYER, query: init }));
            sender._authenticated = true;
        }
        assertActive(); sender.dcId = dcId; sender.userDisconnected = false;
        return sender;
    });
    c._borrowExportedSender = async (dc: number, reconnect = false) => {
        assertActive();
        if (reconnect) { lost(); assertActive(); }
        if (!c._exportedSenderPromises.has(dc)) {
            c._exportedSenderPromises.set(dc, c._connectSender(c._createExportedSender(dc), dc));
        }
        try {
            const sender = await c._exportedSenderPromises.get(dc);
            assertActive();
            if (!sender.isConnected()) { lost(); assertActive(); }
            return sender;
        } catch (e) { lost(); throw e; }
    };
    // Connection-break callback must not drop ownership or recreate a sender.
    c._cleanupExportedSender = async () => { lost(); };
    const destroy = c.destroy.bind(c);
    c.destroy = async () => {
        closed = true; c._destroyed = true;
        // Keep rejected disconnects visible to the supervisor (quarantine), but
        // still run settlement/final closure for all main AND exported senders.
        const results = await Promise.allSettled([destroy(), ...[...senders].map(s => s.disconnect())]);
        while (pending.size) await Promise.allSettled([...pending]);
        const final = await Promise.allSettled([...senders].map(s => s.disconnect()));
        for (const result of [...results, ...final]) if (result.status === 'rejected') throw result.reason;
    };
    return client;
}
