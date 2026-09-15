import { createPortal } from "react-dom";
import { FileText, CheckCircle2, AlertCircle, RotateCcw, Trash2, X } from "./icons";
import { Button } from "./Button";
import { cn } from "../../lib/utils";
import { getUploadQueueOutcome } from "./uploadQueueOutcome";
import type { ChunkUploadSession } from "../../services/api";
import type { UploadTelemetry } from "../../services/uploadTelemetry";
import { IndeterminateSpinner } from "./IndeterminateSpinner";
import { formatBytes } from "../../services/formatBytes";
import { useTranslation } from "react-i18next";

export interface QueueItem {
    id: string;
    file: File;
    status: 'pending' | 'uploading' | 'processing' | 'completed' | 'error' | 'cancelled';
    progress: number;
    error?: string;
    resumeSessionId?: string;
    targetLabel?: string;
    loadedBytes?: number;
    totalBytes?: number;
    bytesPerSecond?: number;
    etaSeconds?: number | null;
    telemetry?: UploadTelemetry;
}

interface UploadQueueModalProps {
    isOpen: boolean;
    onClose: () => void;
    items: QueueItem[];
    recoveredSessions?: ChunkUploadSession[];
    resumingSessionIds?: string[];
    onCancel: (id: string) => void;
    onRetry: (id: string) => void;
    isPaused?: boolean;
    onTogglePause?: () => void;
    onResumeSession?: (session: ChunkUploadSession, file: File) => void;
    onCancelSession?: (session: ChunkUploadSession) => void;
}

function formatDuration(seconds: number | null | undefined, t: (key: string, options?: Record<string, unknown>) => string): string | null {
    if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return null;
    if (seconds <= 0) return t('files.ui.uploadQueue.almostDone');
    if (seconds < 60) return t('files.ui.uploadQueue.seconds', { count: Math.ceil(seconds) });
    if (seconds < 3600) return t('files.ui.uploadQueue.minutes', { count: Math.ceil(seconds / 60) });
    return t('files.ui.uploadQueue.hoursMinutes', { hours: Math.floor(seconds / 3600), minutes: Math.ceil((seconds % 3600) / 60) });
}

export const UploadQueueModal = ({
    isOpen,
    onClose,
    items,
    recoveredSessions = [],
    resumingSessionIds = [],
    onCancel,
    onRetry,
    isPaused = false,
    onTogglePause,
    onResumeSession,
    onCancelSession,
}: UploadQueueModalProps) => {
    const { t } = useTranslation();
    const outcome = getUploadQueueOutcome(items);
    const hasActiveItems = items.some(item => ['pending', 'uploading', 'processing'].includes(item.status));

    // 计算总体完成进度
    const completedCount = items.filter(i => i.status === 'completed' || i.status === 'error' || i.status === 'cancelled').length;
    const totalCount = items.length;

    if (!isOpen) return null;

    const panelContent = (
        <div className="op-queue-dock">
            <aside className="tv-panel op-floating-queue" role="region" aria-label={t('files.ui.uploadQueue.label')}>
                <header className="op-floating-queue-heading">
                    <div>
                        <h3>
                            {items.length === 0 && recoveredSessions.length > 0 ? <RotateCcw className="h-4 w-4 text-primary" />
                                : outcome.kind === 'success' ? <CheckCircle2 className="h-4 w-4 op-tone-success" />
                                : outcome.kind === 'partial' ? <AlertCircle className="h-4 w-4 op-tone-warning" />
                                : outcome.kind === 'failed' ? <AlertCircle className="h-4 w-4 op-tone-danger" />
                                : outcome.kind === 'cancelled' ? <AlertCircle className="h-4 w-4 text-muted-foreground" />
                                : <IndeterminateSpinner label={t('files.ui.uploadQueue.processing')} size="sm" />}
                            {items.length === 0 && recoveredSessions.length > 0 ? t('files.ui.uploadQueue.recoverable') : t(`files.ui.uploadQueue.${outcome.titleKey}`)}
                        </h3>
                        <p aria-live="polite">{totalCount > 0 ? t('files.ui.uploadQueue.currentFiles', { completed: completedCount, total: totalCount }) : t('files.ui.uploadQueue.noBrowserUploads')}{recoveredSessions.length > 0 ? t('files.ui.uploadQueue.serverSessions', { count: recoveredSessions.length }) : ''}</p>
                    </div>
                    <Button variant="ghost" size="icon" className="op-queue-minimize" onClick={onClose} aria-label={t('files.ui.uploadQueue.minimize')} title={t('files.ui.uploadQueue.minimize')}><X className="h-4 w-4" /></Button>
                </header>
                {hasActiveItems && <p className="op-queue-background-note">{t('upload.keepUsing')}</p>}

                <div className="op-floating-queue-body">
                    {recoveredSessions.length > 0 && <section className="op-recovery-section" aria-label={t('files.ui.uploadQueue.recoverable')}>
                        <h4 className="op-queue-group-title"><RotateCcw className="h-3.5 w-3.5" />{t('files.ui.uploadQueue.recoverable')}<span className="op-badge op-badge--warning">{recoveredSessions.length}</span></h4>
                        {recoveredSessions.map(session => {
                            const isResuming = resumingSessionIds.includes(session.uploadId);
                            const target = `${session.targetAccountName || session.targetProvider || t('files.ui.uploadQueue.unknownStorage')} / ${session.folder || t('files.root')}`;
                            return <article key={session.uploadId} className="op-queue-row op-queue-row--recovery">
                                <div className="op-queue-file-heading"><span className="op-file-symbol op-tone-warning">{isResuming ? <IndeterminateSpinner label={t('files.ui.uploadQueue.resuming')} size="sm" /> : <RotateCcw className="h-4 w-4" />}</span><div className="op-queue-file-copy"><h4 title={session.filename}>{session.filename}</h4><p className="op-item-target" title={target}>{t('files.ui.uploadQueue.target', { target })}</p></div></div>
                                <p className="op-queue-file-detail">{t('files.ui.uploadQueue.received', { received: formatBytes(session.receivedBytes), total: formatBytes(session.totalSize) })}{session.status === 'failed' ? t('files.ui.uploadQueue.previousFailed') : session.status === 'completing' ? t('files.ui.uploadQueue.serverProcessingSuffix') : t('files.ui.uploadQueue.chooseOriginal')}</p>
                                {session.error && <p className="op-inline-error">{session.error}</p>}
                                <div className="op-progress op-progress--warning" role="progressbar" aria-label={session.filename} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.max(0, Math.min(100, session.progress))}><span style={{ width: `${Math.max(0, Math.min(100, session.progress))}%` }} /></div>
                                {session.status !== 'completing' && <div className="op-actions op-queue-row-actions">
                                    <label className={cn('op-resume-picker', (isResuming || !onResumeSession) && 'is-disabled')}><RotateCcw className="h-4 w-4" />{session.status === 'failed' ? t('files.ui.uploadQueue.chooseRetry') : t('files.ui.uploadQueue.chooseContinue')}<input className="sr-only" type="file" disabled={isResuming || !onResumeSession} onChange={event => { const file = event.target.files?.[0]; if (file) onResumeSession?.(session, file); event.currentTarget.value = ''; }} /></label>
                                    <Button variant="outline" size="sm" className="op-action op-danger-button" disabled={isResuming || !onCancelSession} onClick={() => onCancelSession?.(session)}><Trash2 className="h-4 w-4" />{t('files.ui.uploadQueue.cancelSession')}</Button>
                                </div>}
                            </article>;
                        })}
                    </section>}

                    <div className="op-current-queue">{items.map(item => <article key={item.id} className="op-queue-row">
                        <div className="op-queue-file-heading">
                            <span className="op-file-symbol"><FileText className="h-4 w-4" /></span>
                            <div className="op-queue-file-copy"><h4 title={item.file.name}>{item.file.name}</h4>{item.targetLabel && <p className="op-item-target" title={item.targetLabel}>{t('files.ui.uploadQueue.target', { target: item.targetLabel })}</p>}</div>
                            <span className={cn('op-badge op-queue-status', item.status === 'completed' ? 'op-badge--success' : item.status === 'error' ? 'op-badge--danger' : ['pending', 'cancelled'].includes(item.status) ? 'op-badge--muted' : 'op-badge--info')}>
                                {item.status === 'completed' && <><CheckCircle2 className="h-3.5 w-3.5" />{t('files.ui.uploadQueue.completed')}</>}
                                {item.status === 'error' && <><AlertCircle className="h-3.5 w-3.5" />{t('files.ui.uploadQueue.failed')}</>}
                                {item.status === 'uploading' && <><IndeterminateSpinner label={t('files.ui.uploadQueue.uploadingFile')} size="sm" />{item.progress}%</>}
                                {item.status === 'processing' && <><IndeterminateSpinner label={t('files.ui.uploadQueue.processingUpload')} size="sm" />{t('files.ui.uploadQueue.processingStatus')}</>}
                                {item.status === 'cancelled' && t('files.ui.uploadQueue.cancelled')}
                                {item.status === 'pending' && t('files.ui.uploadQueue.pending')}
                            </span>
                        </div>
                        {item.error && <p role="alert" className="op-inline-error">{item.error}</p>}
                        {(item.status === 'uploading' || item.status === 'processing' || item.progress > 0) && <>
                            <div className={cn('op-progress', item.status === 'error' && 'op-progress--danger')} role="progressbar" aria-label={item.file.name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.max(0, Math.min(100, item.progress))}><span style={{ width: `${Math.max(0, Math.min(100, item.progress))}%` }} /></div>
                            {(item.loadedBytes !== undefined || item.bytesPerSecond) && <div className="op-queue-telemetry"><span>{formatBytes(item.loadedBytes || 0)} / {formatBytes(item.totalBytes || item.file.size)}</span><span>{item.bytesPerSecond ? `${formatBytes(item.bytesPerSecond)}/s` : t('files.ui.uploadQueue.estimatingSpeed')}{formatDuration(item.etaSeconds, t) ? t('files.ui.uploadQueue.remaining', { duration: formatDuration(item.etaSeconds, t) }) : ''}</span></div>}
                        </>}
                        <div className="op-queue-row-bottom"><span className="op-cell-meta">{formatBytes(item.file.size)}</span><div className="op-actions">
                            {['pending', 'uploading', 'processing'].includes(item.status) && <Button variant="outline" size="sm" onClick={() => onCancel(item.id)}>{t('common.actions.cancel')}</Button>}
                            {['error', 'cancelled'].includes(item.status) && !item.resumeSessionId && <Button variant="outline" size="sm" className="op-action" onClick={() => onRetry(item.id)}><RotateCcw className="h-3.5 w-3.5" />{t('common.actions.retry')}</Button>}
                        </div></div>
                    </article>)}</div>
                </div>
                <footer className="op-floating-queue-footer">
                    {hasActiveItems && onTogglePause && <Button variant="outline" onClick={onTogglePause}>{isPaused ? t('files.ui.uploadQueue.resumeQueue') : t('files.ui.uploadQueue.pauseQueue')}</Button>}
                    <Button variant={hasActiveItems ? 'ghost' : 'default'} onClick={onClose}>{hasActiveItems ? t('files.ui.uploadQueue.minimize') : t('common.actions.close')}</Button>
                </footer>
            </aside>
        </div>
    );
    return createPortal(panelContent, document.body);
};
