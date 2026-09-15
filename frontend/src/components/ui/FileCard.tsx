import { Download, Eye, FileText, Image as ImageIcon, Music, Video, Star } from "./icons";
import { useState, type SyntheticEvent, type MouseEvent, type TouchEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./Button";
import { FileMenu } from "./FileMenu";
import { fileApi, type FileData } from "../../services/api";
import { ContextMenu, createFileMenuItems } from "./ContextMenu";
import { useLongPress } from "../../hooks/useLongPress";
import { ApiActionError, describeActionFailure } from "../../services/apiActionError";
import { authService } from "../../services/auth";
import { activateParentControl } from "../../services/keyboardActivation";
import { getProviderMetadata } from "../../services/providerMetadata";
import { fileBrowserCopy, fileExtension } from "../../services/fileBrowserPresentation";

export type { FileData } from "../../services/api";

const FileIcon = ({ type }: { type: FileData["type"] }) => {
    const Icon = type === 'image' ? ImageIcon : type === 'video' ? Video : type === 'audio' ? Music : FileText;
    return <Icon aria-hidden="true" />;
};

interface FileCardProps {
    file: FileData;
    onPreview?: () => void;
    onDelete?: () => void;
    onRename?: () => void;
    onToggleFavorite?: () => void;
    onMove?: () => void;
    isSelectionMode?: boolean;
    isSelected?: boolean;
    onSelect?: (id: string) => void;
    viewMode?: "grid" | "list";
}

// Keep every child action out of the card's mouse/touch long-press handlers.
const stopPropagation = (event: SyntheticEvent) => event.stopPropagation();
const childEvents = {
    onMouseDown: stopPropagation, onMouseUp: stopPropagation,
    onTouchStart: stopPropagation, onTouchEnd: stopPropagation,
    onClick: stopPropagation, onContextMenu: stopPropagation,
};

export const FileCard = ({
    file, onPreview, onDelete, onRename, onToggleFavorite, onMove,
    isSelectionMode = false, isSelected = false, onSelect, viewMode = "grid",
}: FileCardProps) => {
    const { t, i18n } = useTranslation();
    const copy = fileBrowserCopy(i18n.resolvedLanguage || i18n.language);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
    const [downloadError, setDownloadError] = useState<string | null>(null);
    const [failedThumbnail, setFailedThumbnail] = useState<string | null>(null);

    const handleDownload = async () => {
        try {
            setDownloadError(null);
            await fileApi.downloadFile(file.id, file.name);
        } catch (error: unknown) {
            console.error("Download failed", error);
            if (error instanceof ApiActionError && error.kind === 'unauthorized') authService.invalidateSession(error.status);
            setDownloadError(describeActionFailure(t('files.ui.preview.downloadAction'), error));
        }
    };

    const handleCardClick = () => isSelectionMode ? onSelect?.(file.id) : onPreview?.();
    const handleContextMenu = (event: MouseEvent | TouchEvent) => {
        event.preventDefault();
        event.stopPropagation();
        if (isSelectionMode) return;
        const point = 'touches' in event ? event.touches[0] : event;
        setContextMenu({ x: point?.clientX ?? 0, y: point?.clientY ?? 0 });
    };
    const longPressHandlers = useLongPress({
        onLongPress: handleContextMenu,
        onClick: handleCardClick,
        threshold: 500,
    });
    const handleCardKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        activateParentControl(event, handleCardClick);
    };

    // Signed previews and the existing animated-GIF source are preserved.
    const isMedia = ['image', 'video', 'audio'].includes(file.type);
    const extension = fileExtension(file.name);
    const formatLabel = extension || copy.noExtension;
    const previewLabel = isMedia ? t('files.ui.actions.preview') : copy.details;
    const isGif = file.name.toLowerCase().endsWith('.gif');
    const thumbnailSrc = isGif ? file.previewUrl : (file.thumbnailUrl || (file.type === 'image' ? file.previewUrl : undefined));
    const provider = getProviderMetadata(file.source);
    const SourceIcon = provider.icon;
    const sourceLabel = provider.id === 'local' ? t('appCopy.localStorage') : provider.label;
    const typeLabel = t(file.type === 'image' ? 'app.fileTypes.images' : file.type === 'video' ? 'app.fileTypes.videos' : file.type === 'audio' ? 'app.fileTypes.audio' : 'app.fileTypes.other');

    return (
        <>
            <div
                role="button"
                tabIndex={0}
                aria-label={t(isSelectionMode ? 'files.ui.cards.selectFile' : 'files.ui.cards.openFile', { name: file.name })}
                aria-pressed={isSelectionMode ? isSelected : undefined}
                onKeyDown={handleCardKeyDown}
                className={`tv-file-card tv-file-card--${viewMode}${isSelected ? ' is-selected' : ''}${!isMedia ? ' tv-file-card--document' : ''}`}
                {...(!isSelectionMode ? {
                    ...longPressHandlers,
                    // AT activates role=button with a click and no pointer events.
                    // Physical taps already run on mouse/touch release; ignore
                    // their click (detail > 0) to avoid duplicate/long-press opens.
                    onClick: (event: MouseEvent) => { if (event.detail === 0 && !contextMenu) handleCardClick(); },
                    onMouseDown: (event: MouseEvent) => { if (event.button === 0) longPressHandlers.onMouseDown(event); },
                    onMouseUp: (event: MouseEvent) => { if (event.button === 0) longPressHandlers.onMouseUp(event); },
                } : { onClick: handleCardClick })}
                onContextMenu={handleContextMenu}
            >
                <div className="tv-file-visual">
                    {thumbnailSrc && failedThumbnail !== thumbnailSrc ? (
                        <img src={thumbnailSrc} alt={file.name} loading="lazy" decoding="async" draggable={false} onError={() => setFailedThumbnail(thumbnailSrc)} />
                    ) : (
                        <div className="tv-file-placeholder"><FileIcon type={file.type} />{!isMedia && <span>{formatLabel}</span>}</div>
                    )}
                    {file.is_favorite && <span className="tv-file-favorite" title={t('file.favorite')}><Star aria-hidden="true" /></span>}
                    {viewMode === 'grid' && isMedia && <span className="tv-file-type">{typeLabel}</span>}
                </div>

                {isSelectionMode && (
                    <label className="tv-file-selection" {...childEvents}>
                        <input type="checkbox" checked={isSelected} aria-label={t('files.ui.cards.selectFile', { name: file.name })} onChange={() => onSelect?.(file.id)} />
                    </label>
                )}

                <div className="tv-file-body">
                    <h3 title={file.name}>{file.name}</h3>
                    <p className="tv-file-meta">{!isMedia && viewMode === 'list' && <span className="tv-file-format">{formatLabel}</span>}<span className="tv-file-size">{file.size}</span><span className="tv-file-date">{file.date}</span></p>
                    <span className="tv-file-source" title={sourceLabel}><SourceIcon aria-hidden="true" /><span>{sourceLabel}</span></span>
                </div>

                {!isSelectionMode && (
                    <div className="tv-file-actions" {...childEvents}>
                        <Button variant={isMedia ? "outline" : "ghost"} size="sm" className="tv-file-preview" onClick={() => onPreview?.()} title={previewLabel}>
                            {isMedia ? <Eye aria-hidden="true" /> : <FileText aria-hidden="true" />}<span>{previewLabel}</span>
                        </Button>
                        <Button variant={isMedia ? "ghost" : "outline"} size={isMedia ? "icon" : "sm"} className="tv-file-download" onClick={() => void handleDownload()} aria-label={t('files.ui.actions.download')} title={t('files.ui.actions.download')}>
                            <Download aria-hidden="true" />{!isMedia && <span>{t('files.ui.actions.download')}</span>}
                        </Button>
                        <FileMenu name={file.name} onRename={onRename} onDownload={() => void handleDownload()} onDelete={onDelete} onToggleFavorite={onToggleFavorite} isFavorite={!!file.is_favorite} onMove={onMove} />
                    </div>
                )}
                {downloadError && <p role="alert" className="tv-file-error">{downloadError}</p>}
            </div>
            <ContextMenu
                x={contextMenu?.x ?? 0} y={contextMenu?.y ?? 0} isOpen={!!contextMenu}
                onClose={() => setContextMenu(null)}
                items={createFileMenuItems(t, onRename, () => void handleDownload(), onToggleFavorite, !!file.is_favorite, onDelete, onMove)}
            />
        </>
    );
};
