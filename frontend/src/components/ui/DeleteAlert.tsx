import { useState } from "react";
import { motion } from "framer-motion";
import { Trash2 } from "./icons";
import { useTranslation } from "react-i18next";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import type { BatchDeleteResult } from "../../services/api";
import { formatDeleteSize } from "./deletePresentation";
import './overlays.css';

interface DeleteAlertProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void | Promise<void>;
    fileName?: string;
    itemCount?: number;
    dataFileCount?: number;
    placeholderCount?: number;
    folderCount?: number;
    totalSizeBytes?: number;
    result?: BatchDeleteResult | null;
}

export const DeleteAlert = ({
    isOpen,
    onClose,
    onConfirm,
    fileName,
    itemCount = 0,
    dataFileCount = 0,
    placeholderCount = 0,
    folderCount = 0,
    totalSizeBytes = 0,
    result,
}: DeleteAlertProps) => {
    const { t } = useTranslation();
    const [isDeleting, setIsDeleting] = useState(false);

    if (!isOpen) return null;

    const handleConfirm = async () => {
        if (isDeleting) return;
        setIsDeleting(true);
        try {
            await onConfirm();
        } finally {
            setIsDeleting(false);
        }
    };

    const isPartial = result?.status === 'partial';
    const modalContent = (
        <Dialog open={isOpen} onClose={onClose} labelledBy="delete-alert-title" alert closeOnEscape={!isDeleting} closeOnBackdrop={!isDeleting} describedBy="delete-alert-description">
                <motion.div
                    initial={{ scale: 0.95, opacity: 0, y: 10 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                    exit={{ scale: 0.95, opacity: 0, y: 10 }}
                    transition={{ type: "spring", stiffness: 350, damping: 25 }}
                    className="tv-modal-content" aria-busy={isDeleting}
                >
                    <div className="tv-modal-header">
                        <div className="tv-modal-icon tv-modal-icon--danger">
                            <Trash2 className="h-5 w-5" />
                        </div>
                        <div className="tv-modal-heading">
                            <h3 id="delete-alert-title" className="tv-modal-title">
                                {isPartial ? t('files.ui.deleteDialog.partialTitle') : t('files.ui.deleteDialog.title')}
                            </h3>
                            <p id="delete-alert-description" className="tv-modal-description">
                                {isPartial ? t('files.ui.deleteDialog.partialSubtitle') : t('files.ui.deleteDialog.subtitle')}
                            </p>
                        </div>
                    </div>

                    <div className="tv-modal-body">
                        {isPartial ? (
                            <div className="space-y-3 text-sm">
                                <p className="text-foreground/80">
                                    {t('files.ui.deleteDialog.partialSummary', { deleted: result.deletedIds.length, failed: result.failedFiles.length })}
                                </p>
                                <ul className="tv-result-list">
                                    {result.failedFiles.map(file => (
                                        <li key={file.id} className="tv-wrap">
                                            <span className="font-medium">{file.name}</span>
                                            <span className="block text-xs text-muted-foreground">{file.error}</span>
                                        </li>
                                    ))}
                                </ul>
                                <p className="text-xs text-muted-foreground">{t('files.ui.deleteDialog.partialRetryHint')}</p>
                            </div>
                        ) : (
                            <div className="flex items-start gap-4">
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm text-foreground/80 leading-relaxed">
                                        {itemCount > 0 ? (
                                            <>
                                                {t('files.ui.deleteDialog.dataFiles', { count: dataFileCount })}
                                                {totalSizeBytes > 0 && t('files.ui.deleteDialog.totalSize', { size: formatDeleteSize(totalSizeBytes) })}
                                                {placeholderCount > 0 && (
                                                    <><br />{t('files.ui.deleteDialog.placeholders', { count: placeholderCount })}</>
                                                )}
                                                {folderCount > 0 && (
                                                    <><br />{t('files.ui.deleteDialog.affectedFolders', { count: folderCount })}</>
                                                )}
                                                <br className="mb-2" />
                                                {t('files.ui.deleteDialog.irreversibleQuestion')}
                                            </>
                                        ) : fileName ? (
                                            <>
                                                {t('files.ui.deleteDialog.deleteFile', { name: fileName })}
                                                <br className="mb-2" />
                                                {t('files.ui.deleteDialog.irreversibleQuestion')}
                                            </>
                                        ) : (
                                            t('files.ui.deleteDialog.description')
                                        )}
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="tv-modal-footer">
                        <Button
                            variant="outline"
                            className="tv-modal-action"
                            disabled={isDeleting}
                            onClick={isDeleting ? undefined : onClose}
                        >
                            {isPartial ? t('common.actions.close') : t('common.actions.cancel')}
                        </Button>
                        {!isPartial && (
                            <Button
                                variant="destructive"
                                className="tv-modal-action"
                                onClick={handleConfirm}
                                disabled={isDeleting}
                            >
                                {isDeleting ? t('files.ui.deleteDialog.deleting') : t('files.ui.deleteDialog.confirm')}
                            </Button>
                        )}
                    </div>
                </motion.div>
        </Dialog>
    );

    return modalContent;
};
