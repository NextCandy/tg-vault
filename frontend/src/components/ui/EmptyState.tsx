import { motion } from "framer-motion";
import { FolderOpen, SearchX, WifiOff, AlertTriangle, RefreshCw } from "./icons";
import { useTranslation } from "react-i18next";
import { Button } from "./Button";
import type { FileViewStateKind } from "../../services/fileViewState";
import './overlays.css';

interface EmptyStateProps {
    kind?: FileViewStateKind;
    onRetry?: () => void;
    onClearSearch?: () => void;
    onClearFilter?: () => void;
}

export const EmptyState = ({ kind = 'empty-root', onRetry, onClearSearch, onClearFilter }: EmptyStateProps) => {
    const { t } = useTranslation();
    const key = kind === 'empty-root' ? 'root'
        : kind === 'empty-folder' ? 'folder'
        : kind === 'empty-search' ? 'search'
        : kind === 'empty-filter' ? 'filter'
        : kind;
    const Icon = kind === 'empty-search' ? SearchX
        : kind === 'offline' ? WifiOff
        : kind === 'error' || kind === 'stale' ? AlertTriangle
        : FolderOpen;
    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="tv-empty-state"
            role={kind === 'error' || kind === 'offline' ? 'alert' : 'status'}
        >
            <div className="tv-empty-state__icon" aria-hidden="true">
                <Icon className="h-7 w-7" />
            </div>
            <h3 className="tv-empty-state__title">{t(`empty.${key}.title`)}</h3>
            <p className="tv-empty-state__description">{t(`empty.${key}.description`)}</p>
            <div className="tv-empty-state__actions">
                {(kind === 'offline' || kind === 'error' || kind === 'stale') && onRetry && (
                    <Button variant="outline" onClick={onRetry}><RefreshCw className="h-4 w-4" />{t('empty.retry')}</Button>
                )}
                {kind === 'empty-search' && onClearSearch && <Button variant="outline" onClick={onClearSearch}>{t('empty.clearSearch')}</Button>}
                {kind === 'empty-filter' && onClearFilter && <Button variant="outline" onClick={onClearFilter}>{t('empty.clearFilter')}</Button>}
            </div>
        </motion.div>
    );
};
