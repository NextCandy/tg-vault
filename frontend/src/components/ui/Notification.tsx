import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Cloud, CheckCircle, Info, X, XCircle } from './icons';

import { IndeterminateSpinner } from './IndeterminateSpinner';
import { useTranslation } from 'react-i18next';

export type NotificationType = 'info' | 'success' | 'error' | 'loading';

interface NotificationProps {
    show: boolean;
    message: string;
    type?: NotificationType;
    duration?: number;
    onClose: () => void;
}

export const Notification: React.FC<NotificationProps> = ({
    show,
    message,
    type = 'info',
    duration = 4000,
    onClose
}) => {
    const { t } = useTranslation();
    useEffect(() => {
        if (show && duration > 0 && type !== 'loading') {
            const timer = setTimeout(() => {
                onClose();
            }, duration);
            return () => clearTimeout(timer);
        }
    }, [show, duration, type, onClose]);

    const icons = {
        info: <Info className="h-5 w-5" />,
        success: <CheckCircle className="h-5 w-5" />,
        error: <XCircle className="h-5 w-5" />,
        loading: <IndeterminateSpinner label={message || t('files.ui.notification.processing')} size="md" />
    };


    return (
        <AnimatePresence>
            {show && (
                <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.16 }}
                    className="tv-notification-position"
                >
                    <div
                        role={type === 'error' ? 'alert' : 'status'}
                        aria-live={type === 'error' ? 'assertive' : 'polite'}
                        aria-atomic="true"
                        className={`tv-notification tv-notification--${type}`}>
                        <div className="tv-notification__icon">
                            {type === 'info' && message.includes('OneDrive') ? <Cloud className="h-5 w-5" /> : icons[type]}
                        </div>
                        <p className="tv-notification__message">
                            {message}
                        </p>
                        {type !== 'loading' && (
                            <button type="button" onClick={onClose} className="tv-overlay-icon-button tv-notification__close" aria-label={t('files.ui.notification.close')} title={t('files.ui.notification.close')}>
                                <X className="h-4 w-4" />
                            </button>
                        )}
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};
