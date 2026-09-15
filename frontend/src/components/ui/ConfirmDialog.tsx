import { AlertTriangle } from './icons';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { useTranslation } from 'react-i18next';
import './overlays.css';

export function ConfirmDialog({ isOpen, title, description, confirmLabel, onClose, onConfirm }: {
    isOpen: boolean;
    title: string;
    description: string;
    confirmLabel?: string;
    onClose: () => void;
    onConfirm: () => void | Promise<void>;
}) {
    const { t } = useTranslation();
    const resolvedConfirmLabel = confirmLabel ?? t('common.actions.confirm');
    return (
        <Dialog open={isOpen} onClose={onClose} labelledBy="confirm-dialog-title" describedBy="confirm-dialog-description" alert>
            <div className="tv-modal-header">
                <span className="tv-modal-icon tv-modal-icon--warning"><AlertTriangle className="h-5 w-5" aria-hidden="true" /></span>
                <div className="tv-modal-heading"><h3 id="confirm-dialog-title" className="tv-modal-title">{title}</h3><p id="confirm-dialog-description" className="tv-modal-description">{description}</p></div>
            </div>
            <div className="tv-modal-footer"><Button variant="outline" className="tv-modal-action" onClick={onClose}>{t('common.actions.cancel')}</Button><Button variant="destructive" className="tv-modal-action" onClick={onConfirm}>{resolvedConfirmLabel}</Button></div>
        </Dialog>
    );
}
