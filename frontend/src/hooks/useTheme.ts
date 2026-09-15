import { initializeBackground } from './useBackground';
import { useCallback, useEffect, useState } from "react";

type Theme = "dark" | "light" | "system";
const themeChangeEvent = "tgvault:theme-change";
const systemThemeQuery = "(prefers-color-scheme: dark)";
let memoryTheme: Theme | undefined;

function isTheme(value: unknown): value is Theme {
    return value === "light" || value === "dark" || value === "system";
}

function readTheme(): Theme {
    if (typeof window === "undefined") return "system";
    if (memoryTheme) return memoryTheme;
    try {
        const stored = window.localStorage.getItem("theme");
        if (isTheme(stored)) return stored;
    } catch { /* Private browsing may disable storage; system mode still works. */ }
    return "system";
}

function applyTheme(theme: Theme) {
    if (typeof window === "undefined") return;
    const dark = theme === "dark" || (theme === "system" && Boolean(window.matchMedia?.(systemThemeQuery).matches));
    const root = window.document.documentElement;
    root.classList.toggle("dark", dark);
    root.classList.toggle("light", !dark);
    root.style.colorScheme = dark ? "dark" : "light";
}

/** May be called before createRoot to paint the login/startup screen correctly. */
export function initializeTheme() {
    initializeBackground();
    applyTheme(readTheme());
}

// AppLayout is imported by App before it renders auth/loading screens.
// Bootstrap here so login and first-paint placeholders share the saved theme.
if (typeof window !== "undefined" && typeof document !== "undefined") initializeTheme();

export function useTheme() {
    const [theme, setTheme] = useState<Theme>(readTheme);

    useEffect(() => {
        applyTheme(theme);
        const media = window.matchMedia?.(systemThemeQuery);
        const handleSystemChange = () => { if (theme === "system") applyTheme(theme); };
        media?.addEventListener("change", handleSystemChange);
        return () => media?.removeEventListener("change", handleSystemChange);
    }, [theme]);

    useEffect(() => {
        const handleThemeChange = (event: Event) => {
            const next = (event as CustomEvent<Theme>).detail;
            if (isTheme(next)) setTheme(next);
        };
        const handleStorage = (event: StorageEvent) => {
            if (event.key === "theme" || event.key === null) {
                memoryTheme = undefined;
                const next = readTheme();
                applyTheme(next);
                setTheme(next);
            }
        };
        window.addEventListener(themeChangeEvent, handleThemeChange);
        window.addEventListener("storage", handleStorage);
        return () => {
            window.removeEventListener(themeChangeEvent, handleThemeChange);
            window.removeEventListener("storage", handleStorage);
        };
    }, []);

    const setThemeAndStore = useCallback((next: Theme) => {
        if (!isTheme(next)) return;
        memoryTheme = next;
        try { window.localStorage.setItem("theme", next); } catch { /* Keep an in-memory choice available. */ }
        applyTheme(next);
        setTheme(next);
        // Header, mobile drawer and login controls share the same preference.
        window.dispatchEvent(new CustomEvent<Theme>(themeChangeEvent, { detail: next }));
    }, []);

    return { theme, setTheme: setThemeAndStore };
}
