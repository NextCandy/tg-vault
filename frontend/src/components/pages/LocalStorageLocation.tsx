import { formatNumber } from '../../i18n/format';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/Button';
import { apiRequest } from '../../services/httpClient';
import { API_BASE, normalizeApiBase } from '../../services/config';
import { getApiHeaders } from '../../services/clients/clientHeaders';
import { Copy, HardDrive } from '../ui/icons';
import './settings.css';

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
    const { t, i18n } = useTranslation();
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
    return <div className="settings-surface settings-local" data-local-storage-location>
        {failed ? <div role="alert" className="settings-notice settings-status--danger settings-action-row">
            <span>{label('loadFailed')}</span>
            <Button size="sm" variant="outline" onClick={() => setRevision(r => r + 1)}>{label('retry')}</Button>
        </div> : !info ? <p role="status" className="settings-help">{label('loading')}</p> : <>
            <div className="settings-local__path">
                <div className="settings-local__heading">
                    <HardDrive className="h-4 w-4 text-primary" aria-hidden="true" />
                    <h4>{label('hostPath')}</h4>

                    {info.pathStatus === 'verified' && info.hostPath && <Button size="sm" variant="outline" onClick={async () => {
                        try { await navigator.clipboard.writeText(info.hostPath!); setCopy('copied'); }
                        catch { setCopy('copyFailed'); }
                    }}><Copy className="h-3.5 w-3.5" aria-hidden="true" /><span aria-live="polite">{label(copy)}</span></Button>}
                </div><div className="settings-local__copy"><code data-host-storage-path tabIndex={0} aria-label={label('hostPath')}>{info.pathStatus === 'verified' && info.hostPath ? info.hostPath : label('unconfirmed')}</code></div>
            </div>
            <dl className="settings-local__facts">
                <div>
                    <dt>{label('status')}</dt>
                    <dd aria-live="polite"><span className={`tv-badge settings-status settings-status--${info.status === 'available' ? 'success' : info.status === 'read-only' ? 'warning' : 'danger'}`}>{label(info.status)}</span></dd>
                </div>
                <div>
                    <dt>{label('free')}</dt>
                    <dd className="settings-local__capacity">{info.availableBytes === null ? label('unknown') : `${formatNumber(info.availableBytes / 1024 ** 3, i18n.resolvedLanguage || i18n.language, { maximumFractionDigits: 1 })} GiB`}</dd>
                </div>
            </dl>
            <details className="settings-local__details">
                <summary>{label('details')}</summary>
                <dl>
                    <div><dt>{label('containerPath')}</dt><dd><code>{info.containerPath}</code></dd></div>
                    <div><dt>{label('mountType')}</dt><dd>{info.mountType || label('unknown')}</dd></div>
                </dl>
                <p>{label('capacityNote')}</p>
                <p>{label('mappingNote')}</p>
            </details>
        </>}
    </div>;
}
