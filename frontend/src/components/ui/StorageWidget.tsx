import { useTranslation } from "react-i18next";
import type { StorageStats } from "../../services/api";

interface StorageWidgetProps { stats?: StorageStats | null; used?: number; total?: number }

export const StorageWidget = ({ stats, used, total }: StorageWidgetProps) => {
    const { t } = useTranslation();
    const hasLegacy = typeof used === 'number' && typeof total === 'number';
    const percent = Math.max(0, Math.min(100, stats ? stats.server.usedPercent : hasLegacy && total > 0 ? used / total * 100 : 0));
    return <div className="tv-storage-widget">
        <div className="tv-storage-widget__heading">
            <span>{t(stats ? 'files.ui.storage.server' : 'sidebar.storage.uc')}</span>
            <strong>{stats || hasLegacy ? `${Math.round(percent)}%` : '—'}</strong>
        </div>
        <div className="tv-storage-widget__track" aria-hidden="true">
            <span style={{ width: `${percent}%`, background: percent > 90 ? 'var(--tv-danger)' : percent > 70 ? 'var(--tv-warning)' : 'hsl(var(--primary))' }} />
        </div>
        <p>{stats ? `${stats.server.used} / ${stats.server.total}` : hasLegacy ? t('sidebar.storage.used', { used, total }) : '—'}</p>
        {stats && <div className="tv-storage-widget__usage">
            <div className="tv-storage-widget__heading"><span>TG Vault</span><span>{t('files.ui.storage.fileCount', { count: stats.tgvault.fileCount })}</span></div>
            <p>{t('files.ui.storage.used', { value: stats.tgvault.used })}</p>
        </div>}
    </div>;
};
