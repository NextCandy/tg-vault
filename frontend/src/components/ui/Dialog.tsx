import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const focusSelector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Nested dialogs share one scroll lock; only the top dialog owns keyboard focus.
const dialogStack: HTMLDivElement[] = [];
let savedBodyOverflow = '';
let rootPreviousFocus: HTMLElement | null = null;

export function Dialog({
    open,
    onClose,
    children,
    labelledBy,
    describedBy,
    alert = false,
    closeOnEscape = true,
    closeOnBackdrop = true,
    className = '',
}: {
    open: boolean;
    onClose: () => void;
    children: ReactNode;
    labelledBy: string;
    describedBy?: string;
    alert?: boolean;
    closeOnEscape?: boolean;
    closeOnBackdrop?: boolean;
    className?: string;
}) {
    const contentRef = useRef<HTMLDivElement>(null);
    const onCloseRef = useRef(onClose);
    const closeOnEscapeRef = useRef(closeOnEscape);
    useEffect(() => {
        onCloseRef.current = onClose;
        closeOnEscapeRef.current = closeOnEscape;
    }, [onClose, closeOnEscape]);

    // Keep the focus trap mounted for the lifetime of the dialog. Re-running
    // this effect on every parent render would focus the first button again,
    // which makes a mobile swipe jump back to the top during QR polling.
    useLayoutEffect(() => {
        if (!open) return;
        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const content = contentRef.current;
        if (!content) return;
        if (!dialogStack.length) {
            rootPreviousFocus = previousFocus;
            savedBodyOverflow = document.body.style.overflow;
            document.body.style.overflow = 'hidden';
        }
        dialogStack.push(content);
        const focusables = () => Array.from(content.querySelectorAll<HTMLElement>(focusSelector)).filter(element => {
            for (let node: HTMLElement | null = element; node && node !== content; node = node.parentElement) {
                if (node.hidden || node.inert || node.getAttribute('aria-hidden') === 'true') return false;
                const style = window.getComputedStyle(node);
                if (style.display === 'none' || style.visibility === 'hidden') return false;
            }
            return true;
        });
        (focusables()[0] || content).focus();
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented || dialogStack[dialogStack.length - 1] !== content) return;
            if (event.key === 'Escape' && closeOnEscapeRef.current) { event.preventDefault(); event.stopPropagation(); onCloseRef.current(); return; }
            if (event.key !== 'Tab') return;
            const items = focusables();
            if (!items.length) { event.preventDefault(); content?.focus(); return; }
            const first = items[0], last = items[items.length - 1];
            if (event.shiftKey && (document.activeElement === first || document.activeElement === content || !content.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && (document.activeElement === last || document.activeElement === content || !content.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('keydown', onKeyDown);
            const wasTopDialog = dialogStack[dialogStack.length - 1] === content;
            const index = dialogStack.indexOf(content);
            if (index !== -1) dialogStack.splice(index, 1);
            if (!dialogStack.length) {
                document.body.style.overflow = savedBodyOverflow;
                if (rootPreviousFocus?.isConnected) rootPreviousFocus.focus();
                rootPreviousFocus = null;
            } else if (wasTopDialog && previousFocus?.isConnected) previousFocus.focus();
        };
    }, [open]);
    if (!open) return null;
    return createPortal(
        <div className="tv-dialog-backdrop" role="presentation" onMouseDown={event => { if (closeOnBackdrop && event.target === event.currentTarget && dialogStack[dialogStack.length - 1] === contentRef.current) onCloseRef.current(); }}>
            <div ref={contentRef} role={alert ? 'alertdialog' : 'dialog'} aria-modal="true" aria-labelledby={labelledBy} aria-describedby={describedBy} tabIndex={-1} className={`tv-dialog ${className}`} onMouseDown={event => event.stopPropagation()}>
                {children}
            </div>
        </div>,
        document.body,
    );
}
