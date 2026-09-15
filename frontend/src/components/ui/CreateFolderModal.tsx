import { useState } from "react";
import { motion } from "framer-motion";
import { FolderPlus } from "./icons";
import { useTranslation } from "react-i18next";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { performAsyncMutation } from "../../services/asyncMutation";
import './overlays.css';

interface CreateFolderModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (folderName: string) => Promise<void>;
    currentFolder?: string | null;
}

export const CreateFolderModal = ({ isOpen, onClose, onConfirm, currentFolder }: CreateFolderModalProps) => {
    const { t } = useTranslation();
    const [folderName, setFolderName] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);

    if (!isOpen) return null;

    const handleConfirm = async () => {
        if (folderName.trim() && !isSubmitting) {
            setIsSubmitting(true);
            setSubmitError(null);
            await performAsyncMutation({
                action: () => onConfirm(folderName.trim()),
                onSuccess: () => {
                    setFolderName("");
                    onClose();
                },
                onFailure: error => setSubmitError(error instanceof Error ? error.message : t('files.ui.createFolder.failed')),
                onSettled: () => setIsSubmitting(false),
            });
        }
    };

    const handleClose = () => {
        if (isSubmitting) return;
        setFolderName("");
        onClose();
    };

    const modalContent = (
        <Dialog open={isOpen} onClose={handleClose} closeOnEscape={!isSubmitting} closeOnBackdrop={!isSubmitting} labelledBy="create-folder-title" describedBy="create-folder-description">
            <motion.div className="tv-modal-content" aria-busy={isSubmitting} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.16 }}>
                    {/* Header */}
                    <div className="tv-modal-header">
                        <div className="tv-modal-icon">
                            <FolderPlus className="h-5 w-5" />
                        </div>
                        <div className="tv-modal-heading">
                            <h3 id="create-folder-title" className="tv-modal-title">
                                {t('files.ui.createFolder.title')}
                            </h3>
                            <p id="create-folder-description" className="tv-modal-description">
                                {t('files.ui.createFolder.location', { location: currentFolder || t('files.root') })}
                            </p>
                        </div>
                    </div>

                    {/* Content */}
                    <div className="tv-modal-body">
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <label htmlFor="newFolderName" className="tv-field-label">
                                    {t('files.ui.createFolder.nameLabel')}
                                </label>
                                <input
                                    id="newFolderName"
                                    type="text"
                                    className="tv-modal-field"
                                    aria-invalid={Boolean(submitError)}
                                    aria-describedby={submitError ? "create-folder-error" : undefined}
                                    placeholder={t('files.ui.createFolder.placeholder')}
                                    value={folderName}
                                    onChange={(e) => setFolderName(e.target.value)}
                                    disabled={isSubmitting}
                                    // Dialog owns initial focus and captures the opener first.
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") void handleConfirm();
                                    }}
                                />
                            </div>
                            {submitError && <p id="create-folder-error" role="alert" className="tv-form-error">{submitError}</p>}
                        </div>
                    </div>

                    {/* Footer - Buttons */}
                    <div className="tv-modal-footer">
                        <Button
                            variant="outline"
                            className="tv-modal-action"
                            onClick={handleClose}
                            disabled={isSubmitting}
                        >
                            {t('common.actions.cancel')}
                        </Button>
                        <Button
                            className="tv-modal-action"
                            onClick={handleConfirm}
                            disabled={isSubmitting || !folderName.trim()}
                        >
                            {isSubmitting ? t('files.ui.createFolder.creating') : t('files.ui.createFolder.confirm')}
                        </Button>

                    </div>
            </motion.div>
        </Dialog>
    );

    return modalContent;
};
