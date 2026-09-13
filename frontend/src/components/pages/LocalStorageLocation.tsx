import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/Button';
import { apiRequest } from '../../services/httpClient';
import { API_BASE, normalizeApiBase } from '../../services/config';
import { getApiHeaders } from '../../services/clients/clientHeaders';

export interface LocationInfo {
    hostPath: string | null;
    pathStatus: 'verified' | 'unconfirmed';
    status: 'available' | 'read-only' | 'unavailable';
    availableBytes: number | null;
    totalBytes: number | null;
    containerPath: string;
    mountType: string | null;
}

export function LocalStorageLocation() {
    const { t } = useTranslation();
    const [info, setInfo] = useState<LocationInfo | null>(null);
    const [failed, setFailed] = useState(false);
    const [copy, setCopy] = useState('copy');
    const [revision, setRevision] = useState(0);
    useEffect(() => {
        const controller = new AbortController();
        setFailed(false);
        apiRequest(`${normalizeApiBase(API_BASE)}/api/storage/local-location`, {
            credentials: 'include', headers: getApiHeaders(), signal: controller.signal,
        }).then(async response => {
            if (!response.ok) throw new Error('location unavailable');
            const data = await response.json() as LocationInfo;
            if (!controller.signal.aborted) setInfo(data);
        }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
        return () => controller.abort();
    }, [revision]);
    const label = (key: string) => t(`localStorageLocation.${key}`);
    return <div className="min-w-0 space-y-3 px-4 pb-4 text-sm" data-local-storage-location>
        {failed ? <div role="alert">{label('loadFailed')} <Button size="sm" variant="outline" onClick={() => setRevision(r => r + 1)}>{label('retry')}</Button></div> : !info ? <p role="status">{label('loading')}</p> : <>
            <div className="space-y-2">
                <p className="font-medium">{label('hostPath')}</p>
                <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start">
                    <code className="min-w-0 flex-1 break-all whitespace-normal rounded bg-muted p-2" data-host-storage-path>{info.pathStatus === 'verified' && info.hostPath ? info.hostPath : label('unconfirmed')}</code>
                    {info.pathStatus === 'verified' && info.hostPath && <Button size="sm" variant="outline" className="shrink-0" onClick={async () => {
                        try { await navigator.clipboard.writeText(info.hostPath!); setCopy('copied'); }
                        catch { setCopy('copyFailed'); }
                    }}>{label(copy)}</Button>}
                </div>
                <p aria-live="polite">{label('status')}: {label(info.status)}</p>
                <p>{label('free')}: {info.availableBytes === null ? label('unknown') : `${(info.availableBytes / 1024 ** 3).toLocaleString(undefined, { maximumFractionDigits: 1 })} GiB`}</p>
            </div>
            <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer py-1">{label('details')}</summary>
                <p className="break-all">{label('containerPath')}: {info.containerPath}</p>
                <p>{label('mountType')}: {info.mountType || label('unknown')}</p>
                <p>{label('capacityNote')}</p>
                <p>{label('mappingNote')}</p>
            </details>
        </>}
    </div>;
}
