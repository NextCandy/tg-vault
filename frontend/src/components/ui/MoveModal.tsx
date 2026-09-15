import { motion } from "framer-motion";
import { Folder, FolderRoot, ArrowRight, Check, X } from "./icons";
import { useTranslation } from "react-i18next";
import { Button } from "./Button";
import { useState, useEffect } from "react";
import { Dialog } from "./Dialog";
import type { FolderMovePreview } from "../../services/api";
import { performAsyncMutation } from "../../services/asyncMutation";
import { formatBytes } from "../../services/formatBytes";
import './overlays.css';

interface MoveModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (destinationFolder: string | null) => Promise<void>;
    currentFolder: string | null;
    folders: string[]; // List of available folder names
    title?: string;
    sourceFolder?: string;
    isFolder?: boolean;
    onPreview?: (destinationFolder: string | null, signal: AbortSignal) => Promise<FolderMovePreview>;
}

export const MoveModal = ({ isOpen, onClose, onConfirm, currentFolder, folders, title, sourceFolder, isFolder = false, onPreview }: MoveModalProps) => {
    const { t } = useTranslation();
    const [selectedFolder, setSelectedFolder] = useState<string | null>(currentFolder);
    const [preview, setPreview] = useState<FolderMovePreview | null>(null);
    const [previewError, setPreviewError] = useState<string | null>(null);
    const [isPreviewLoading, setIsPreviewLoading] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen) {
            setSelectedFolder(currentFolder);
            setSubmitError(null);
            setIsSubmitting(false);
        }
    }, [isOpen, currentFolder]);

    useEffect(() => {
        if (!isOpen || !isFolder || !onPreview || selectedFolder === currentFolder) {
            setPreview(null);
            setPreviewError(null);
            setIsPreviewLoading(false);
            return;
        }
        const controller = new AbortController();
        setIsPreviewLoading(true);
        setPreviewError(null);
        onPreview(selectedFolder, controller.signal)
            .then(result => setPreview(result))
            .catch(error => {
                if (error?.name !== 'AbortError') setPreviewError(error?.message || t('files.ui.move.previewFailed'));
            })
            .finally(() => {
                if (!controller.signal.aborted) setIsPreviewLoading(false);
            });
        return () => controller.abort();
    }, [currentFolder, isFolder, isOpen, onPreview, selectedFolder]);

    // Filter out the current folder from the list
    const availableFolders = folders.filter(folder =>
        folder !== currentFolder
        && (!isFolder || !sourceFolder || (folder !== sourceFolder && !folder.startsWith(`${sourceFolder}/`)))
    );

    if (!isOpen) return null;

    const isChanged = selectedFolder !== currentFolder;
    const canConfirm = isChanged && !isPreviewLoading && !previewError && (!isFolder || (!!preview && !preview.conflict));

    const modalContent = (
        <Dialog open={isOpen} onClose={onClose} labelledBy="move-modal-title" describedBy="move-modal-description" closeOnEscape={!isSubmitting} closeOnBackdrop={!isSubmitting}>
                <motion.div
                    initial={{ scale: 0.95, opacity: 0, y: 10 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                    exit={{ scale: 0.95, opacity: 0, y: 10 }}
                    transition={{ type: "spring", stiffness: 350, damping: 25 }}
                    className="tv-modal-content" aria-busy={isSubmitting}
                >
                    {/* Header */}
                    <div className="tv-modal-header">
                        <div className="tv-modal-icon">
                            <ArrowRight className="h-5 w-5" />
                        </div>
                        <div className="tv-modal-heading">
                            <h3 id="move-modal-title" className="tv-modal-title">
                                {title || t('files.ui.move.title')}
                            </h3>
                            <p id="move-modal-description" className="tv-modal-description">{t('files.ui.move.subtitle')}</p>
                        </div>
                        <button
                            type="button"
                            onClick={isSubmitting ? undefined : onClose}
                            disabled={isSubmitting}
                            className="tv-overlay-icon-button"
                            aria-label={t('files.ui.move.close')}
                            title={t('files.ui.move.close')}
                        >
                            <X className="h-4 w-4 text-muted-foreground" />
                        </button>
                    </div>

                    {/* Current location hint */}
                    {currentFolder && (
                        <div className="tv-modal-section">
                            <div className="tv-location-row">
                                <span className="text-muted-foreground font-medium">{t('files.ui.move.currentLocation')}</span>
                                <div className="tv-location-value">
                                    <Folder className="h-3 w-3 text-muted-foreground" />
                                    <span className="tv-wrap font-medium">{currentFolder}</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {isFolder && isChanged && (
                        <div className="tv-modal-section tv-wrap" aria-live="polite">
                            {isPreviewLoading ? (
                                <p className="text-muted-foreground">{t('files.ui.move.previewLoading')}</p>
                            ) : previewError ? (
                                <p className="text-destructive">{previewError}</p>
                            ) : preview ? (
                                <div className="space-y-1.5">
                                    <p><span className="text-muted-foreground">{t('files.ui.move.finalPath')}</span><strong>{preview.finalPath}</strong></p>
                                    <p className="text-muted-foreground">{t('files.ui.move.impact', { folders: preview.folderCount, files: preview.fileCount, size: formatBytes(preview.totalSizeBytes) })}</p>
                                    {preview.conflict && <p className="text-destructive">{preview.conflictReason}</p>}
                                </div>
                            ) : null}
                        </div>
                    )}

                    {submitError && <p role="alert" className="tv-modal-section tv-form-error">{submitError}</p>}

                    {/* Folder List */}
                    <div className="tv-folder-list"
                        style={{
                            scrollbarWidth: 'thin',
                            scrollbarColor: 'hsl(var(--muted-foreground) / 0.2) transparent',
                        }}
                    >
                        <div className="space-y-1">
                            {/* Root Folder Option */}
                            <button
                                type="button"
                                disabled={isSubmitting}
                                aria-pressed={selectedFolder === null}
                                onClick={() => setSelectedFolder(null)}
                                className={`tv-folder-option ${selectedFolder === null ? "is-selected" : ""}`}
                            >
                                <div className="tv-folder-option__icon">
                                    <FolderRoot className="h-4 w-4" />
                                </div>
                                <span className="tv-folder-option__name">
                                    {t('files.root')}
                                </span>
                                {selectedFolder === null && (
                                    <motion.div
                                        initial={{ scale: 0 }}
                                        animate={{ scale: 1 }}
                                        className="tv-folder-option__check"
                                    >
                                        <Check className="h-3 w-3 text-primary-foreground" />
                                    </motion.div>
                                )}
                            </button>

                            {/* Divider */}
                            {availableFolders.length > 0 && (
                                <div className="my-1.5 mx-3 border-t border-border/30" />
                            )}

                            {/* Existing Folders */}
                            {availableFolders.map((folder) => (
                                <button
                                    key={folder}
                                    type="button"
                                    disabled={isSubmitting}
                                    aria-pressed={selectedFolder === folder}
                                    onClick={() => setSelectedFolder(folder)}
                                    className={`tv-folder-option ${selectedFolder === folder ? "is-selected" : ""}`}
                                >
                                    <div className="tv-folder-option__icon">
                                        <Folder className="h-4 w-4" />
                                    </div>
                                    <span className="tv-folder-option__name" title={folder}>
                                        {folder}
                                    </span>
                                    {selectedFolder === folder && (
                                        <motion.div
                                            initial={{ scale: 0 }}
                                            animate={{ scale: 1 }}
                                            className="tv-folder-option__check"
                                        >
                                            <Check className="h-3 w-3 text-primary-foreground" />
                                        </motion.div>
                                    )}
                                </button>
                            ))}

                            {/* Empty state */}
                            {availableFolders.length === 0 && (
                                <div className="tv-folder-list-empty">
                                    <Folder className="h-7 w-7" />
                                    <p className="text-xs">{t("app.noOtherFolders")}</p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="tv-modal-footer">
                        <Button
                            variant="outline"
                            className="tv-modal-action"
                            onClick={onClose}
                            disabled={isSubmitting}
                        >
                            {t('common.actions.cancel')}
                        </Button>
                        <Button 
                            onClick={async () => {
                                if (isSubmitting) return;
                                setIsSubmitting(true);
                                setSubmitError(null);
                                await performAsyncMutation({
                                    action: () => onConfirm(selectedFolder),
                                    onSuccess: onClose,
                                    onFailure: error => setSubmitError(error instanceof Error ? error.message : t('files.ui.move.failed')),
                                    onSettled: () => setIsSubmitting(false),
                                });
                            }} 
                            className="tv-modal-action"
                            disabled={!canConfirm || isSubmitting}
                        >
                            {isSubmitting ? t('files.ui.move.moving') : t('files.ui.move.confirm')}
                        </Button>
                    </div>
                </motion.div>
        </Dialog>
    );

    return modalContent;
};
