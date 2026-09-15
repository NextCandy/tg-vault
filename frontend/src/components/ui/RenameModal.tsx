import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Pencil } from "./icons";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import './overlays.css';

interface RenameModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (newName: string) => void | Promise<void>;
    currentName: string;
    type: "file" | "folder";
}

export const RenameModal = ({ isOpen, onClose, onConfirm, currentName, type }: RenameModalProps) => {
    const { t } = useTranslation();

    // Split file name into base + extension
    const getBaseName = (name: string) => {
        if (type === "folder") return name;
        const dotIndex = name.lastIndexOf(".");
        return dotIndex > 0 ? name.slice(0, dotIndex) : name;
    };

    const getExtension = (name: string) => {
        if (type === "folder") return "";
        const dotIndex = name.lastIndexOf(".");
        return dotIndex > 0 ? name.slice(dotIndex) : "";
    };

    const [baseName, setBaseName] = useState(getBaseName(currentName));
    const [error, setError] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const extension = getExtension(currentName);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isOpen) {
            setBaseName(getBaseName(currentName));
            setError("");
            setIsSubmitting(false);
            // Auto-focus and select text
            setTimeout(() => {
                if (inputRef.current) {
                    inputRef.current.focus();
                    inputRef.current.select();
                }
            }, 100);
        }
    }, [isOpen, currentName]);

    const handleConfirm = async () => {
        if (isSubmitting) return;
        const trimmed = baseName.trim();
        if (trimmed.length === 0) {
            setError(t(type === 'file' ? 'files.ui.rename.fileNameRequired' : 'files.ui.rename.folderNameRequired'));
            return;
        }
        if (/[\\:*?"<>|/]/.test(trimmed)) {
            setError(t('files.ui.rename.invalidCharacters'));
            return;
        }
        const newName = type === "file" ? trimmed + extension : trimmed;
        if (newName === currentName) {
            onClose();
            return;
        }
        setIsSubmitting(true);
        setError("");
        try {
            await onConfirm(newName);
        } catch (confirmError) {
            setError(confirmError instanceof Error ? confirmError.message : t('files.ui.rename.failed'));
        } finally {
            setIsSubmitting(false);
            requestAnimationFrame(() => inputRef.current?.focus());
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (isSubmitting) return;
        if (e.key === "Enter") {
            e.preventDefault();
            void handleConfirm();
        } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
        }
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <Dialog
                    open={isOpen}
                    onClose={onClose}
                    closeOnEscape={!isSubmitting}
                    closeOnBackdrop={!isSubmitting}
                    labelledBy="rename-modal-title"
                    describedBy={error ? "rename-modal-error" : undefined}
                >
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 10 }}
                        transition={{ duration: 0.15 }}
                        className="tv-modal-content" aria-busy={isSubmitting}
                    >
                        {/* Header */}
                        <div className="tv-modal-header">
                            <div className="tv-modal-icon">
                                <Pencil className="h-5 w-5 text-primary" />
                            </div>
                            <div className="tv-modal-heading">
                                <h3 id="rename-modal-title" className="tv-modal-title">
                                    {t('files.ui.rename.title')}
                                </h3>
                                {type === "file" && extension && (
                                    <p className="tv-modal-description">
                                        {t('files.ui.rename.extensionHint')}
                                    </p>
                                )}
                            </div>
                        </div>

                        {/* Input */}
                        <div className="tv-modal-body">
                            <div className="tv-input-group">
                                <input
                                    ref={inputRef}
                                    type="text"
                                    className="tv-input-group__input"
                                    aria-label={t('files.ui.rename.placeholder')}
                                    aria-invalid={Boolean(error)}
                                    aria-describedby={error ? "rename-modal-error" : undefined}
                                    disabled={isSubmitting}
                                    placeholder={t('files.ui.rename.placeholder')}
                                    value={baseName}
                                    onChange={(e) => {
                                        setBaseName(e.target.value);
                                        setError("");
                                    }}
                                    onKeyDown={handleKeyDown}
                                />
                                {type === "file" && extension && (
                                    <span className="tv-input-group__suffix">
                                        {extension}
                                    </span>
                                )}
                            </div>
                            {error && (
                                <p id="rename-modal-error" role="alert" className="tv-form-error">{error}</p>
                            )}
                        </div>

                        {/* Actions */}
                        <div className="tv-modal-footer">
                            <Button
                                variant="outline"
                                className="tv-modal-action"
                                onClick={isSubmitting ? undefined : onClose}
                                disabled={isSubmitting}
                            >
                                {t('common.actions.cancel')}
                            </Button>
                            <Button
                                className="tv-modal-action"
                                onClick={() => void handleConfirm()}
                                disabled={isSubmitting}
                            >
                                {isSubmitting ? t('files.ui.rename.renaming') : t('files.ui.rename.confirm')}
                            </Button>
                        </div>
                    </motion.div>
                </Dialog>
            )}
        </AnimatePresence>
    );
};
