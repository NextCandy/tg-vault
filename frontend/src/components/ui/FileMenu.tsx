import { useEffect, useId, useLayoutEffect, useRef, useState, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";
import { MoreVertical, Pencil, Download, Trash2, Star, FolderInput } from "./icons";
import { useTranslation } from "react-i18next";

interface FileMenuProps {
    onRename?: () => void;
    onDownload?: () => void;
    onDelete?: () => void;
    onToggleFavorite?: () => void;
    isFavorite?: boolean;
    onMove?: () => void;
    name?: string;
}

export const FileMenu = ({ onRename, onDownload, onDelete, onToggleFavorite, isFavorite = false, onMove, name }: FileMenuProps) => {
    const { t } = useTranslation();
    const [isOpen, setIsOpen] = useState(false);
    const [position, setPosition] = useState({ left: 0, top: 0 });
    const triggerRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const menuId = useId();
    const menuLabel = name ? t('files.ui.actions.more', { name }) : t('file.moreActions');
    const items = [
        onRename && { label: t('files.ui.actions.rename'), icon: Pencil, action: onRename },
        onMove && { label: t('files.ui.actions.move'), icon: FolderInput, action: onMove },
        onDownload && { label: t('files.ui.actions.download'), icon: Download, action: onDownload },
        onToggleFavorite && { label: t(isFavorite ? 'files.ui.actions.unfavorite' : 'files.ui.actions.favorite'), icon: Star, action: onToggleFavorite },
        onDelete && { label: t('files.ui.actions.delete'), icon: Trash2, action: onDelete, danger: true },
    ].filter(Boolean) as { label: string; icon: typeof Pencil; action: () => void; danger?: boolean }[];
    const stop = (event: SyntheticEvent) => event.stopPropagation();
    const close = (restoreFocus = false) => {
        setIsOpen(false);
        if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
    };

    useLayoutEffect(() => {
        if (!isOpen || !menuRef.current || !triggerRef.current) return;
        const trigger = triggerRef.current.getBoundingClientRect();
        const menu = menuRef.current.getBoundingClientRect();
        setPosition({
            left: Math.max(8, Math.min(trigger.right - menu.width, window.innerWidth - menu.width - 8)),
            top: Math.max(8, trigger.bottom + 6 + menu.height > window.innerHeight ? trigger.top - menu.height - 6 : trigger.bottom + 6),
        });
        menuRef.current.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true });
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        const outside = (event: MouseEvent | TouchEvent) => {
            if (!menuRef.current?.contains(event.target as Node) && !triggerRef.current?.contains(event.target as Node)) setIsOpen(false);
        };
        const dismiss = () => setIsOpen(false);
        const scroll = (event: Event) => {
            if (!(event.target instanceof Node) || !menuRef.current?.contains(event.target)) dismiss();
        };
        const escape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') { event.preventDefault(); setIsOpen(false); triggerRef.current?.focus({ preventScroll: true }); }
        };
        document.addEventListener('mousedown', outside);
        document.addEventListener('touchstart', outside, { passive: true });
        document.addEventListener('keydown', escape);
        window.addEventListener('resize', dismiss);
        window.addEventListener('scroll', scroll, true);
        return () => {
            document.removeEventListener('mousedown', outside);
            document.removeEventListener('touchstart', outside);
            document.removeEventListener('keydown', escape);
            window.removeEventListener('resize', dismiss);
            window.removeEventListener('scroll', scroll, true);
        };
    }, [isOpen]);

    return (
        <div className="tv-file-menu" onClick={stop} onMouseDown={stop} onMouseUp={stop} onTouchStart={stop} onTouchEnd={stop} onContextMenu={stop}>
            <button ref={triggerRef} type="button" className="tv-file-icon-action" aria-label={menuLabel} aria-haspopup="menu" aria-expanded={isOpen} aria-controls={isOpen ? menuId : undefined} onClick={() => setIsOpen(open => !open)} onKeyDown={event => {
                if (event.key === 'ArrowDown') { event.preventDefault(); setIsOpen(true); }
            }}><MoreVertical aria-hidden="true" /></button>
            {isOpen && createPortal(
                <div ref={menuRef} id={menuId} className="tv-file-popover" role="menu" aria-label={menuLabel} style={position} onClick={stop} onMouseDown={stop} onMouseUp={stop} onTouchStart={stop} onTouchEnd={stop} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }} onKeyDown={event => {
                    event.stopPropagation();
                    if (event.key === 'Escape') { event.preventDefault(); close(true); return; }
                    if (event.key === 'Tab') { close(true); return; }
                    const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
                    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
                    const next = event.key === 'ArrowDown' ? (index + 1) % buttons.length : event.key === 'ArrowUp' ? (index - 1 + buttons.length) % buttons.length : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1;
                    if (next >= 0) { event.preventDefault(); buttons[next]?.focus({ preventScroll: true }); }
                }}>
                    {items.map(({ label, icon: Icon, action, danger }) => <button key={label} type="button" role="menuitem" className={danger ? 'tv-file-menu-danger' : undefined} onClick={event => { event.stopPropagation(); close(true); action(); }}><Icon aria-hidden="true" /><span>{label}</span></button>)}
                </div>, document.body,
            )}
        </div>
    );
};
