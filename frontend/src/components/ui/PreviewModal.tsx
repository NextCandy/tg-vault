import { motion } from "framer-motion";
import { X, FileText, Download, Video, Music, ZoomIn, ZoomOut, ChevronLeft, ChevronRight, Maximize2, RotateCcw, Copy, Check, Info, RefreshCw } from "./icons";
import type { FileData } from "./FileCard";
import { Button } from "./Button";
import { useEffect, useRef, useState } from "react";
import { fileApi } from "../../services/api";
import { MobileMenu } from "./MobileMenu";
import { IndeterminateSpinner } from "./IndeterminateSpinner";
import { ApiActionError, describeActionFailure } from "../../services/apiActionError";
import { authService } from "../../services/auth";
import { Dialog } from "./Dialog";
import { useTranslation } from "react-i18next";
import { tr } from "../../i18n/runtime";
import './overlays.css';

interface PreviewModalProps {
    file: FileData | null;
    onClose: () => void;
    onToggleFavorite?: (fileId: string) => void;
    files?: FileData[];
    onNavigate?: (file: FileData) => void;
}

const resolveMediaErrorMessage = async (fileId: string, fallback: string): Promise<string> => {
    try {
        const status = await fileApi.getMediaStatus(fileId);
        if (status.code === 'MEDIA_SOURCE_MISSING') return tr('files.ui.preview.sourceMissing');
        if (status.code === 'MEDIA_QUOTA_EXCEEDED') return tr('files.ui.preview.quotaExceeded');
        if (status.code === 'MEDIA_RATE_LIMITED') return tr('files.ui.preview.rateLimited');
        if (status.error) return status.error;
        return fallback;
    } catch {
        return fallback;
    }
};

// 视频播放器组件
const VideoPlayer = ({ file }: { file: FileData }) => {
    const { t } = useTranslation();
    const [hasError, setHasError] = useState(false);
    const [errorMessage, setErrorMessage] = useState(() => tr('files.ui.preview.mediaUnavailable'));
    const [isLoading, setIsLoading] = useState(true);
    const [isBuffering, setIsBuffering] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const videoRef = useRef<HTMLVideoElement>(null);

    useEffect(() => {
        setHasError(false);
        setErrorMessage(tr('files.ui.preview.mediaUnavailable'));
        setIsLoading(true);
        setIsBuffering(false);
    }, [file.previewUrl]);

    const handleDownload = async () => {
        try {
            await fileApi.downloadFile(file.id, file.name);
        } catch (error) {
            console.error("下载视频失败", error);
        }
    };

    const handleReload = () => {
        setHasError(false);
        setIsLoading(true);
        setIsBuffering(false);
        setReloadKey(key => key + 1);
        window.setTimeout(() => videoRef.current?.load(), 0);
    };

    if (hasError) {
        return (
            <div className="flex flex-col items-center gap-4 p-8 text-center text-white">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/10">
                    <Video className="h-8 w-8 text-white/80" />
                </div>
                <div className="space-y-1">
                    <p className="text-base font-medium text-white">{t('files.ui.preview.videoFailed')}</p>
                    <p className="mx-auto max-w-xs text-xs text-white/60">{errorMessage}</p>
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                    <Button onClick={handleReload} size="sm" variant="secondary" className="gap-2">
                        <RefreshCw className="h-4 w-4" />
                        {t('files.ui.preview.reload')}
                    </Button>
                    <Button onClick={handleDownload} size="sm" variant="secondary" className="gap-2">
                        <Download className="h-4 w-4" />
                        {t('files.ui.preview.downloadVideo')}
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="relative flex items-center justify-center">
            {(isLoading || isBuffering) && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-lg bg-black/35 pointer-events-none">
                    <IndeterminateSpinner label={isLoading ? t('files.ui.preview.loadingPreview') : t('files.ui.preview.bufferingVideo')} size="lg" tone="inverse" />
                    <span className="text-xs text-white/70">{isLoading ? t('files.ui.preview.loadingVideoInfo') : t('files.ui.preview.buffering')}</span>
                </div>
            )}
            <video
                key={`${file.previewUrl}-${reloadKey}`}
                ref={videoRef}
                src={file.previewUrl}
                controls
                preload="metadata"
                poster={file.thumbnailUrl}
                playsInline
                className="tv-preview-media bg-black"
                onLoadedMetadata={() => setIsLoading(false)}
                onCanPlay={() => { setIsLoading(false); setIsBuffering(false); }}
                onWaiting={() => setIsBuffering(true)}
                onPlaying={() => setIsBuffering(false)}
                onError={() => {
                    setIsLoading(false);
                    setIsBuffering(false);
                    setHasError(true);
                    void resolveMediaErrorMessage(file.id, tr('files.ui.preview.mediaUnavailable')).then(setErrorMessage);
                }}
            >
                {t('files.ui.preview.videoUnsupported')}
            </video>
        </div>
    );
};

const AudioPlayer = ({ file }: { file: FileData }) => {
    const { t } = useTranslation();
    const [hasError, setHasError] = useState(false);
    const [errorMessage, setErrorMessage] = useState(() => tr('files.ui.preview.mediaUnavailable'));
    const [isLoading, setIsLoading] = useState(true);
    const [reloadKey, setReloadKey] = useState(0);
    const audioRef = useRef<HTMLAudioElement>(null);

    useEffect(() => {
        setHasError(false);
        setErrorMessage(tr('files.ui.preview.mediaUnavailable'));
        setIsLoading(true);
    }, [file.previewUrl]);

    const handleReload = () => {
        setHasError(false);
        setIsLoading(true);
        setReloadKey(key => key + 1);
        window.setTimeout(() => audioRef.current?.load(), 0);
    };

    return (
        <div className="flex w-full max-w-md flex-col items-center justify-center gap-6 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="tv-preview-audio-icon">
                <Music className="h-10 w-10 text-white" />
            </div>
            <div className="max-w-full space-y-1 text-center">
                <h3 className="tv-wrap text-base font-medium text-white">{file.name}</h3>
                <p className="text-sm text-white/60">{file.size}</p>
            </div>
            {hasError ? (
                <div className="flex flex-col items-center gap-3 text-center text-white/80">
                    <p className="font-medium text-white">{t('files.ui.preview.audioFailed')}</p>
                    <p className="text-xs text-white/60">{errorMessage}</p>
                    <Button onClick={handleReload} size="sm" variant="secondary" className="gap-2">
                        <RefreshCw className="h-4 w-4" />
                        {t('files.ui.preview.reload')}
                    </Button>
                </div>
            ) : (
                <div className="relative w-full">
                    {isLoading && (
                        <div className="mb-3 flex justify-center">
                            <IndeterminateSpinner label={t('files.ui.preview.loadingAudio')} size="md" tone="inverse" />
                        </div>
                    )}
                    <audio
                        key={`${file.previewUrl}-${reloadKey}`}
                        ref={audioRef}
                        src={file.previewUrl}
                        controls
                        preload="metadata"
                        playsInline
                        className="w-full shadow-lg"
                        onLoadedMetadata={() => setIsLoading(false)}
                        onCanPlay={() => setIsLoading(false)}
                        onError={() => {
                            setIsLoading(false);
                            setHasError(true);
                            void resolveMediaErrorMessage(file.id, tr('files.ui.preview.mediaUnavailable')).then(setErrorMessage);
                        }}
                    >
                        {t('files.ui.preview.audioUnsupported')}
                    </audio>
                </div>
            )}
        </div>
    );
};

export const PreviewModal = ({ file, onClose, onToggleFavorite, files = [], onNavigate }: PreviewModalProps) => {
    const { t } = useTranslation();
    const [scale, setScale] = useState(1);
    const [imageLoaded, setImageLoaded] = useState(false);
    const [imageError, setImageError] = useState(false);
    const [imageErrorMessage, setImageErrorMessage] = useState(() => tr('files.ui.preview.mediaUnavailable'));
    const [imageReloadKey, setImageReloadKey] = useState(0);
    const [detailsOpen, setDetailsOpen] = useState(false);
    const [idCopied, setIdCopied] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    const touchStartXRef = useRef<number | null>(null);
    const openedAtRef = useRef<number>(0);
    const [mobileMenu, setMobileMenu] = useState<{
        isOpen: boolean;
        x: number;
        y: number;
    }>({
        isOpen: false,
        x: 0,
        y: 0
    });

    const imageFiles = files.filter(item => item.type === 'image');
    const currentImageIndex = file?.type === 'image' ? imageFiles.findIndex(item => item.id === file.id) : -1;
    const canGoPrevious = currentImageIndex > 0;
    const canGoNext = currentImageIndex >= 0 && currentImageIndex < imageFiles.length - 1;
    const showImageNavigation = file?.type === 'image' && imageFiles.length > 1;

    const navigateImageBy = (delta: -1 | 1) => {
        if (currentImageIndex < 0) return;
        const nextFile = imageFiles[currentImageIndex + delta];
        if (nextFile) onNavigate?.(nextFile);
    };

    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            // Dialog owns Escape and the shared scroll lock, including details.
            if (e.defaultPrevented || detailsOpen || mobileMenu.isOpen) return;
            if (file?.type === 'image' && e.key === "ArrowLeft") navigateImageBy(-1);
            if (file?.type === 'image' && e.key === "ArrowRight") navigateImageBy(1);
        };
        window.addEventListener("keydown", handleEsc);
        return () => window.removeEventListener("keydown", handleEsc);
    }, [file, currentImageIndex, detailsOpen, mobileMenu.isOpen, onNavigate]);

    useEffect(() => {
        if (file) {
            openedAtRef.current = Date.now();
            setScale(1);
            setImageLoaded(false);
            setImageError(false);
            setImageErrorMessage(t('files.ui.preview.mediaUnavailable'));
            setDetailsOpen(false);
            setIdCopied(false);
        }

    }, [onClose, file, currentImageIndex]);

    const handleDownload = async (e?: React.MouseEvent) => {
        e?.stopPropagation();
        if (!file) return;
        try {
            setActionError(null);
            await fileApi.downloadFile(file.id, file.name);
        } catch (error) {
            console.error("下载失败", error);
            if (error instanceof ApiActionError && error.kind === 'unauthorized') authService.invalidateSession(error.status);
            setActionError(describeActionFailure(t('files.ui.preview.downloadAction'), error));
        }
    };

    const handleMobileMenuClose = () => {
        setMobileMenu(prev => ({ ...prev, isOpen: false }));
    };

    const handleZoomIn = (e: React.MouseEvent) => {
        e.stopPropagation();
        setScale(prev => Math.min(prev + 0.25, 3));
    };

    const handleZoomOut = (e: React.MouseEvent) => {
        e.stopPropagation();
        setScale(prev => Math.max(prev - 0.25, 0.5));
    };

    const handleResetZoom = (e?: React.MouseEvent) => {
        e?.stopPropagation();
        setScale(1);
    };

    const handleOpenOriginal = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!file) return;
        try {
            setActionError(null);
            const url = await fileApi.getOriginalFileLink(file.id);
            window.open(url, '_blank', 'noopener,noreferrer');
        } catch (error) {
            if (error instanceof ApiActionError && error.kind === 'unauthorized') authService.invalidateSession(error.status);
            setActionError(describeActionFailure(t('files.ui.preview.openOriginalAction'), error));
        }
    };

    const handleCopyId = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!file) return;
        try {
            setActionError(null);
            await navigator.clipboard.writeText(file.id);
            setIdCopied(true);
            window.setTimeout(() => setIdCopied(false), 1500);
        } catch (error) {
            setActionError(describeActionFailure(t('files.ui.preview.copyIdAction'), error));
        }
    };

    const handleTouchStart = (e: React.TouchEvent) => {
        touchStartXRef.current = e.touches[0]?.clientX ?? null;
    };

    const handleTouchEnd = (e: React.TouchEvent) => {
        const startX = touchStartXRef.current;
        touchStartXRef.current = null;
        if (startX === null || scale > 1 || file?.type !== 'image') return;
        const endX = e.changedTouches[0]?.clientX ?? startX;
        const delta = endX - startX;
        if (Math.abs(delta) < 60) return;
        if (delta > 0) navigateImageBy(-1);
        else navigateImageBy(1);
    };

    const handleBackdropClose = (e: React.MouseEvent) => {
        e.stopPropagation();
        // Ignore the opening tap/click that may bubble into the newly mounted modal
        // or be replayed by mobile browsers as a synthetic click.
        if (Date.now() - openedAtRef.current < 350) return;
        if (e.target !== e.currentTarget) return;
        onClose();
    };

    const PreviewContent = () => {
        if (!file) return null;

        if (file.type === "image") {
            return (
                <div
                    className="relative flex items-center justify-center"
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => {
                        e.stopPropagation();
                        setScale(prev => prev === 1 ? 2 : 1);
                    }}
                >
                    {!imageLoaded && !imageError && (
                        <div className="absolute inset-0 flex items-center justify-center z-10">
                            <IndeterminateSpinner label={t('files.ui.preview.loadingPreview')} size="lg" tone="inverse" />
                        </div>
                    )}
                    {file.thumbnailUrl && (
                        <img
                            src={file.thumbnailUrl}
                            alt=""
                            aria-hidden="true"
                            className={`tv-preview-media tv-preview-media--thumbnail ${imageLoaded ? 'opacity-0' : 'opacity-40'}`}
                        />
                    )}
                    {imageError ? (
                        <div className="flex flex-col items-center gap-3 p-8 text-white/80">
                            <FileText className="h-16 w-16 opacity-60" />
                            <p>{t('files.ui.preview.imageFailed')}</p>
                            <p className="max-w-xs text-center text-xs text-white/60">{imageErrorMessage}</p>
                            <div className="flex flex-wrap justify-center gap-2">
                                <Button
                                    variant="secondary"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setImageError(false);
                                        setImageLoaded(false);
                                        setImageReloadKey(key => key + 1);
                                    }}
                                    className="gap-2"
                                >
                                    <RefreshCw className="h-4 w-4" />
                                    {t('files.ui.preview.reload')}
                                </Button>
                                <Button variant="secondary" onClick={handleOpenOriginal}>{t('files.ui.preview.viewOriginalImage')}</Button>
                            </div>
                        </div>
                    ) : (
                        <motion.img
                            key={`${file.previewUrl}-${imageReloadKey}`}
                            src={file.previewUrl}
                            alt={file.name}
                            animate={{ scale }}
                            transition={{ duration: 0.2 }}
                            drag={scale > 1}
                            dragConstraints={{ left: -500, right: 500, top: -500, bottom: 500 }}
                            dragElastic={0.08}
                            onLoad={() => setImageLoaded(true)}
                            onError={() => {
                                setImageError(true);
                                void resolveMediaErrorMessage(file.id, t('files.ui.preview.mediaUnavailable')).then(setImageErrorMessage);
                            }}
                            className={`tv-preview-media tv-preview-media--image ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
                        />
                    )}
                </div>
            );
        }
        if (file.type === "video") {
            return (
                <div onClick={(e) => e.stopPropagation()}>
                    <VideoPlayer file={file} />
                </div>
            );
        }
        if (file.type === "audio") {
            return <AudioPlayer file={file} />;
        }
        return (
            <div className="flex flex-col items-center justify-center gap-6 text-white/80 p-6 sm:p-10 max-w-md min-w-0 text-center" onClick={(e) => e.stopPropagation()}>
                <FileText className="h-24 w-24 opacity-50" />
                <div className="space-y-2">
                    <p className="text-lg font-medium text-white">{t('files.ui.preview.unsupported')}</p>
                    <p className="tv-wrap text-sm text-white/60">{file.name}</p>
                </div>
                <Button variant="secondary" size="lg" onClick={handleDownload} className="mt-4 gap-2">
                    <Download className="h-5 w-5" />
                    {t('files.ui.preview.downloadToView')}
                </Button>
            </div>
        );
    };

    if (!file) return null;

    const modalContent = (
        <Dialog open={Boolean(file)} onClose={onClose} closeOnBackdrop={false} labelledBy="preview-title" className="tv-preview-dialog">
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="tv-preview-layout"
                    onClick={handleBackdropClose}
                >
                    {/* 顶部工具栏 */}
                    <div
                        className="tv-preview-toolbar"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="tv-preview-heading">
                            <span className="tv-modal-icon" aria-hidden="true"><FileText className="h-5 w-5" /></span>
                            <div className="tv-preview-heading__text">
                                <h3 id="preview-title" className="tv-preview-title" title={file.name}>{file.name}</h3>
                                <p className="tv-preview-meta"><span>{file.size}</span><span>{file.date}</span></p>
                            </div>
                        </div>

                        <div className="tv-preview-actions">
                            <Button
                                variant="ghost"
                                size="icon"
                                className="tv-overlay-icon-button"
                                onClick={(e) => { e.stopPropagation(); setDetailsOpen(true); }}
                                title={t('files.ui.preview.details')}
                                aria-label={t('files.ui.preview.details')}
                            >
                                <Info className="h-4 w-4" />
                            </Button>
                            {file.type === 'image' && (
                                <div className="hidden items-center sm:flex">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="tv-overlay-icon-button"
                                        onClick={handleZoomOut}
                                        title={t('files.ui.preview.zoomOut')}
                                        aria-label={t('files.ui.preview.zoomOutImage')}
                                    >
                                        <ZoomOut className="h-5 w-5" />
                                    </Button>
                                    <span className="tv-preview-zoom-value">{Math.round(scale * 100)}%</span>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="tv-overlay-icon-button"
                                        onClick={handleZoomIn}
                                        title={t('files.ui.preview.zoomIn')}
                                        aria-label={t('files.ui.preview.zoomInImage')}
                                    >
                                        <ZoomIn className="h-5 w-5" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="tv-overlay-icon-button"
                                        onClick={handleResetZoom}
                                        title={t('files.ui.preview.resetZoom')}
                                        aria-label={t('files.ui.preview.resetImageZoom')}
                                    >
                                        <RotateCcw className="h-4 w-4" />
                                    </Button>
                                    <div className="tv-preview-divider" />
                                </div>
                            )}
                            {(file.type === 'image' || file.type === 'video') && (
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="tv-overlay-icon-button"
                                    onClick={handleOpenOriginal}
                                    title={t('files.ui.preview.viewOriginal')}
                                    aria-label={t('files.ui.preview.viewOriginal')}
                                >
                                    <Maximize2 className="h-4 w-4" />
                                </Button>
                            )}
                            <Button
                                variant="ghost"
                                size="icon"
                                className="tv-overlay-icon-button"
                                onClick={handleDownload}
                                title={t('files.ui.actions.download')}
                                aria-label={t('files.ui.actions.download')}
                            >
                                <Download className="h-5 w-5" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="tv-overlay-icon-button"
                                onClick={onClose}
                                title={t('common.actions.close')}
                                aria-label={t('common.actions.close')}
                            >
                                <X className="h-6 w-6" />
                            </Button>
                        </div>
                    </div>

                    {actionError && !detailsOpen && (
                        <div role="alert" className="tv-preview-action-error tv-notification tv-notification--error">
                            {actionError}
                        </div>
                    )}

                    <Dialog open={detailsOpen} onClose={() => setDetailsOpen(false)} labelledBy="preview-file-details-title">
                                <div className="tv-modal-content" onClick={(e) => e.stopPropagation()}>
                                    <div className="tv-modal-header">
                                        <span className="tv-modal-icon" aria-hidden="true"><Info className="h-5 w-5" /></span>
                                        <h2 id="preview-file-details-title" className="tv-modal-title tv-modal-heading">{t('files.ui.preview.details')}</h2>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="tv-overlay-icon-button"
                                            onClick={() => setDetailsOpen(false)}
                                            aria-label={t('files.ui.preview.closeDetails')}
                                        >
                                            <X className="h-4 w-4" />
                                        </Button>
                                    </div>
                                    <dl className="tv-preview-details tv-modal-body">
                                        <div>
                                            <dt>{t('files.ui.preview.fileName')}</dt>
                                            <dd>{file.name}</dd>
                                        </div>
                                        <div className="tv-preview-details__columns">
                                            <div>
                                                <dt>{t('files.ui.preview.size')}</dt>
                                                <dd>{file.size}</dd>
                                            </div>
                                            <div>
                                                <dt>{t('files.ui.preview.time')}</dt>
                                                <dd>{file.date}</dd>
                                            </div>
                                        </div>
                                        <div>
                                            <dt>{t('files.ui.preview.fileId')}</dt>
                                            <dd className="tv-preview-file-id">
                                                <span className="min-w-0 flex-1 break-all font-mono text-xs">ID: {file.id}</span>
                                                <button
                                                    type="button"
                                                    className="tv-overlay-icon-button"
                                                    onClick={handleCopyId}
                                                    title={idCopied ? t('files.ui.preview.copiedFileId') : t('files.ui.preview.copyFileId')}
                                                    aria-label={idCopied ? t('files.ui.preview.fileIdCopied') : t('files.ui.preview.copyFileId')}
                                                >
                                                    {idCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                                                </button>
                                            </dd>
                                        </div>
                                    </dl>
                                    {actionError && <p role="alert" className="tv-modal-section tv-form-error">{actionError}</p>}
                                </div>
                    </Dialog>

                    {/* 内容区域 - 占满剩余空间并居中显示 */}
                    <div 
                        className={`tv-preview-stage ${file.type === 'audio' || !['image', 'video'].includes(file.type) ? 'tv-preview-stage--document' : ''}`}
                        onClick={(e) => e.stopPropagation()}
                        onTouchStart={handleTouchStart}
                        onTouchEnd={handleTouchEnd}
                    >
                        {showImageNavigation && canGoPrevious && (
                            <button
                                type="button"
                                className="tv-preview-navigation tv-preview-navigation--previous"
                                onClick={(e) => { e.stopPropagation(); navigateImageBy(-1); }}
                                aria-label={t('files.ui.preview.previousImage')}
                                title={t('files.ui.preview.previousImage')}
                            >
                                <ChevronLeft className="h-8 w-8" />
                            </button>
                        )}
                        {showImageNavigation && canGoNext && (
                            <button
                                type="button"
                                className="tv-preview-navigation tv-preview-navigation--next"
                                onClick={(e) => { e.stopPropagation(); navigateImageBy(1); }}
                                aria-label={t('files.ui.preview.nextImage')}
                                title={t('files.ui.preview.nextImage')}
                            >
                                <ChevronRight className="h-8 w-8" />
                            </button>
                        )}
                        {showImageNavigation && (
                            <div className="tv-preview-swipe-hint">
                                {t('files.ui.preview.swipeHint', { current: currentImageIndex + 1, total: imageFiles.length })}
                            </div>
                        )}
                        <PreviewContent />
                    </div>

                    {/* 移动端菜单 */}
                    <MobileMenu
                        isOpen={mobileMenu.isOpen}
                        x={mobileMenu.x}
                        y={mobileMenu.y}
                        isFavorite={file?.is_favorite || false}
                        onDelete={() => {
                            // 这里可以添加删除功能
                        }}
                        onToggleFavorite={() => {
                            onToggleFavorite?.(file?.id || '');
                        }}
                        onDownload={handleDownload}
                        onClose={handleMobileMenuClose}
                    />
                </motion.div>
        </Dialog>
    );

    return modalContent;
};
