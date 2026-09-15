import { Folder, Star, ChevronRight } from "./icons";
import { useState, type SyntheticEvent, type MouseEvent, type TouchEvent } from "react";
import { useTranslation } from "react-i18next";
import { FileMenu } from "./FileMenu";
import { type FileData } from "../../services/api";
import { ContextMenu, createFolderMenuItems } from "./ContextMenu";
import { useLongPress } from "../../hooks/useLongPress";
import { activateParentControl } from "../../services/keyboardActivation";

export interface FolderData {
    name: string;
    displayName?: string;
    files: FileData[];
    fileCount: number;
    coverFile?: FileData;
    latestDate?: string;
    isFavorite?: boolean;
}

interface FolderCardProps {
    folder: FolderData;
    onClick: () => void;
    onRename?: () => void;
    onToggleFavorite?: () => void;
    onDelete?: () => void;
    onMove?: () => void;
    isSelectionMode?: boolean;
    isSelected?: boolean;
    onSelect?: (name: string) => void;
    viewMode?: "grid" | "list";
}

const stopPropagation = (event: SyntheticEvent) => event.stopPropagation();
const childEvents = {
    onMouseDown: stopPropagation, onMouseUp: stopPropagation,
    onTouchStart: stopPropagation, onTouchEnd: stopPropagation,
    onClick: stopPropagation, onContextMenu: stopPropagation,
};

export const FolderCard = ({
    folder, onClick, onRename, onToggleFavorite, onDelete, onMove,
    isSelectionMode = false, isSelected = false, onSelect, viewMode = "grid",
}: FolderCardProps) => {
    const { t } = useTranslation();
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
    const [failedThumbnail, setFailedThumbnail] = useState<string | null>(null);
    const coverFile = folder.coverFile;
    const thumbnailSrc = coverFile?.thumbnailUrl || (coverFile?.type === 'image' ? coverFile.previewUrl : undefined);
    const isFavorite = folder.isFavorite ?? (folder.files.length > 0 && folder.files.every(file => !!file.is_favorite));
    const handleCardClick = () => isSelectionMode ? onSelect?.(folder.name) : onClick();
    const handleContextMenu = (event: MouseEvent | TouchEvent) => {
        event.preventDefault();
        event.stopPropagation();
        if (isSelectionMode) return;
        const point = 'touches' in event ? event.touches[0] : event;
        setContextMenu({ x: point?.clientX ?? 0, y: point?.clientY ?? 0 });
    };
    const longPressHandlers = useLongPress({ onLongPress: handleContextMenu, onClick: handleCardClick, threshold: 500 });

    return (
        <>
            <div
                role="button" tabIndex={0}
                aria-label={t(isSelectionMode ? 'files.ui.cards.selectFolder' : 'files.ui.cards.openFolder', { name: folder.displayName || folder.name })}
                aria-pressed={isSelectionMode ? isSelected : undefined}
                onKeyDown={event => activateParentControl(event, handleCardClick)}
                className={`tv-folder-card tv-folder-card--${viewMode}${isSelected ? ' is-selected' : ''}`}
                {...(!isSelectionMode ? {
                    ...longPressHandlers,
                    onMouseDown: (event: MouseEvent) => { if (event.button === 0) longPressHandlers.onMouseDown(event); },
                    onMouseUp: (event: MouseEvent) => { if (event.button === 0) longPressHandlers.onMouseUp(event); },
                } : { onClick: handleCardClick })}
                onContextMenu={handleContextMenu}
            >
                {isSelectionMode && (
                    <label className="tv-folder-selection" {...childEvents}>
                        <input type="checkbox" checked={isSelected} aria-label={t('files.ui.cards.selectFolder', { name: folder.name })} onChange={() => onSelect?.(folder.name)} />
                    </label>
                )}
                <div className="tv-folder-cover" aria-hidden="true">
                    {thumbnailSrc && failedThumbnail !== thumbnailSrc ? (
                        <><img src={thumbnailSrc} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailedThumbnail(thumbnailSrc)} /><Folder className="tv-folder-cover-mark" /></>
                    ) : <Folder />}
                </div>
                <div className="tv-folder-body">
                    <h3 title={folder.name}>{folder.displayName || folder.name}</h3>
                    <p>{t('uiAudit.inside')} {t('files.ui.cards.folderFiles', { count: folder.fileCount })}</p>
                </div>
                {isFavorite && <Star className="tv-folder-favorite" aria-label={t('file.favorite')} />}
                {!isSelectionMode && (
                    <div className="tv-folder-actions" {...childEvents}>
                        <FileMenu name={folder.name} onRename={onRename} onToggleFavorite={onToggleFavorite} isFavorite={isFavorite} onDelete={onDelete} onMove={onMove} />
                    </div>
                )}
                {!isSelectionMode && <ChevronRight className="tv-folder-open" aria-hidden="true" />}
            </div>
            <ContextMenu
                x={contextMenu?.x ?? 0} y={contextMenu?.y ?? 0} isOpen={!!contextMenu}
                onClose={() => setContextMenu(null)}
                items={createFolderMenuItems(t, onRename, onToggleFavorite, isFavorite, onDelete, onMove)}
            />
        </>
    );
};
