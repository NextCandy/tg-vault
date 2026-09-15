import { motion, AnimatePresence } from "framer-motion";
import { Pencil, Download, Trash2, Star, FolderInput } from "./icons";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import './overlays.css';

export interface ContextMenuItem {
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
    variant?: "default" | "danger";
}

interface ContextMenuProps {
    x: number;
    y: number;
    isOpen: boolean;
    onClose: () => void;
    items: ContextMenuItem[];
}

// Measure the real content, including translated labels, before painting.
function usePopoverPosition(menuRef: RefObject<HTMLDivElement | null>, isOpen: boolean, x: number, y: number) {
    const [position, setPosition] = useState({ left: x, top: y });
    useLayoutEffect(() => {
        if (!isOpen || !menuRef.current) return;
        const update = () => {
            const menu = menuRef.current;
            if (!menu) return;
            const viewport = window.visualViewport;
            const left = (viewport?.offsetLeft ?? 0) + 8;
            const top = (viewport?.offsetTop ?? 0) + 8;
            const width = viewport?.width ?? window.innerWidth;
            const height = viewport?.height ?? window.innerHeight;
            menu.style.minWidth = `${Math.max(0, Math.min(184, width - 16))}px`;
            menu.style.maxWidth = `${Math.max(0, Math.min(320, width - 16))}px`;
            menu.style.maxHeight = `${Math.max(0, height - 16)}px`;
            const next = {
                left: Math.max(left, Math.min(x, left + width - 16 - menu.offsetWidth)),
                top: Math.max(top, Math.min(y, top + height - 16 - menu.offsetHeight)),
            };
            setPosition(previous => previous.left === next.left && previous.top === next.top ? previous : next);
        };
        update();
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
        observer?.observe(menuRef.current);
        window.addEventListener('resize', update);
        window.visualViewport?.addEventListener('resize', update);
        window.visualViewport?.addEventListener('scroll', update);
        return () => {
            observer?.disconnect();
            window.removeEventListener('resize', update);
            window.visualViewport?.removeEventListener('resize', update);
            window.visualViewport?.removeEventListener('scroll', update);
        };
    }, [isOpen, x, y, menuRef]);
    return position;
}

function usePopoverInteraction(menuRef: RefObject<HTMLDivElement | null>, isOpen: boolean, onClose: () => void) {
    const onCloseRef = useRef(onClose);
    useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
    useEffect(() => {
        if (!isOpen || !menuRef.current) return;
        const menu = menuRef.current;
        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const buttons = () => Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])'));
        buttons()[0]?.focus({ preventScroll: true });
        const handleClickOutside = (e: MouseEvent) => {
            if (!menu.contains(e.target as Node)) onCloseRef.current();
        };
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.defaultPrevented) return;
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                onCloseRef.current();
                return;
            }
            if (e.key === 'Tab') {
                e.preventDefault();
                e.stopPropagation();
                onCloseRef.current();
                return;
            }
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
            const items = buttons();
            if (!items.length) return;
            e.preventDefault();
            e.stopPropagation();
            const current = items.indexOf(document.activeElement as HTMLButtonElement);
            const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1
                : (current + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
            items[next]?.focus();
        };
        const handleScroll = (e: Event) => {
            if (!(e.target instanceof Node) || !menu.contains(e.target)) onCloseRef.current();
        };
        document.addEventListener("mousedown", handleClickOutside);
        menu.addEventListener('keydown', handleKeyDown);
        document.addEventListener('keydown', handleKeyDown);
        window.addEventListener("scroll", handleScroll, true);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
            menu.removeEventListener('keydown', handleKeyDown);
            document.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener("scroll", handleScroll, true);
            if (previousFocus?.isConnected && (menu.contains(document.activeElement) || document.activeElement === document.body)) previousFocus.focus({ preventScroll: true });
        };
    }, [isOpen, menuRef]);
}

export const ContextMenu = ({ x, y, isOpen, onClose, items }: ContextMenuProps) => {
    const menuRef = useRef<HTMLDivElement>(null);
    const position = usePopoverPosition(menuRef, isOpen, x, y);
    usePopoverInteraction(menuRef, isOpen, onClose);

    return createPortal(
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    role="menu"
                    ref={menuRef}
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    transition={{ duration: 0.12 }}
                    className="tv-popover-menu"
                    style={position}
                >
                    {items.map((item, index) => (
                        <button
                            type="button"
                            role="menuitem"
                            key={index}
                            className={`tv-menu-item ${item.variant === "danger" ? "tv-menu-item--danger" : ""}`}
                            onClick={(e) => {
                                e.stopPropagation();
                                item.onClick();
                                onClose();
                            }}
                        >
                            <span className="tv-menu-item__icon">{item.icon}</span>
                            <span className="tv-menu-item__label">{item.label}</span>
                        </button>
                    ))}
                </motion.div>
            )}
        </AnimatePresence>,
        document.body
    );
};

// Helper to create standard file context menu items
export const createFileMenuItems = (
    t: (key: string) => string,
    onRename?: () => void,
    onDownload?: () => void,
    onToggleFavorite?: () => void,
    isFavorite: boolean = false,
    onDelete?: () => void,
    onMove?: () => void
): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [];

    if (onRename) {
        items.push({
            label: t('files.ui.actions.rename'),
            icon: <Pencil className="h-4 w-4" />,
            onClick: onRename,
        });
    }

    if (onMove) {
        items.push({
            label: t('files.ui.actions.move'),
            icon: <FolderInput className="h-4 w-4" />,
            onClick: onMove,
        });
    }
    if (onDownload) {
        items.push({
            label: t('files.ui.actions.download'),
            icon: <Download className="h-4 w-4" />,
            onClick: onDownload,
        });
    }

    if (onToggleFavorite) {
        items.push({
            label: isFavorite ? t('files.ui.actions.unfavorite') : t('files.ui.actions.favorite'),
            icon: <Star className="h-4 w-4" weight={isFavorite ? 'fill' : 'regular'} />,
            onClick: onToggleFavorite,
        });
    }

    if (onDelete) {
        items.push({
            label: t('files.ui.actions.delete'),
            icon: <Trash2 className="h-4 w-4" />,
            onClick: onDelete,
            variant: "danger",
        });
    }

    return items;
};

// Helper to create standard folder context menu items
export const createFolderMenuItems = (
    t: (key: string) => string,
    onRename?: () => void,
    onToggleFavorite?: () => void,
    isFavorite: boolean = false,
    onDelete?: () => void,
    onMove?: () => void
): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [];

    if (onRename) {
        items.push({
            label: t('files.ui.actions.rename'),
            icon: <Pencil className="h-4 w-4" />,
            onClick: onRename,
        });
    }

    if (onMove) {
        items.push({
            label: t('files.ui.actions.move'),
            icon: <FolderInput className="h-4 w-4" />,
            onClick: onMove,
        });
    }
    if (onDelete) {
        items.push({
            label: t('files.ui.actions.delete'),
            icon: <Trash2 className="h-4 w-4" />,
            onClick: onDelete,
            variant: "danger",
        });
    }

    if (onToggleFavorite) {
        items.splice(onDelete ? items.length - 1 : items.length, 0, {
            label: isFavorite ? t('files.ui.actions.unfavorite') : t('files.ui.actions.favorite'),
            icon: <Star className="h-4 w-4" weight={isFavorite ? 'fill' : 'regular'} />,
            onClick: onToggleFavorite,
        });
    }

    return items;
};
