import { Trash2, Star, Download, Share2 } from "./icons";
import { useTranslation } from "react-i18next";
import { createPortal } from 'react-dom';
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";

interface MobileMenuProps {
    onDelete?: () => void;
    onToggleFavorite?: () => void;
    onDownload?: () => void;
    onShare?: () => void;
    isFavorite?: boolean;
    isOpen: boolean;
    onClose: () => void;
    x: number;
    y: number;
}

export const MobileMenu = ({
    onDelete,
    onToggleFavorite,
    onDownload,
    onShare,
    isFavorite = false,
    isOpen,
    onClose,
    x,
    y,
}: MobileMenuProps) => {
    const { t } = useTranslation();
    const items: ContextMenuItem[] = [];

    if (onToggleFavorite) items.push({
        label: isFavorite ? t('file.unfavorite') : t('file.favorite'),
        icon: <Star className="h-4 w-4" weight={isFavorite ? 'fill' : 'regular'} />,
        onClick: onToggleFavorite,
    });
    if (onDownload) items.push({
        label: t('file.download'),
        icon: <Download className="h-4 w-4" />,
        onClick: onDownload,
    });
    if (onShare) items.push({
        label: t('file.share'),
        icon: <Share2 className="h-4 w-4" />,
        onClick: onShare,
    });
    if (onDelete) items.push({
        label: t('file.delete'),
        icon: <Trash2 className="h-4 w-4" />,
        onClick: onDelete,
        variant: 'danger',
    });

    // Same portal, viewport clamp, keyboard navigation and dismissal as desktop.
    return <>
        {isOpen && createPortal(<div className="tv-menu-backdrop" role="presentation" onClick={onClose} />, document.body)}
        <ContextMenu x={x} y={y} isOpen={isOpen} onClose={onClose} items={items} />
    </>;
};
