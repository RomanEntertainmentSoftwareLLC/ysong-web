// src/components/UINavbar.tsx
import { useEffect, useRef, useState } from "react";
import { useTheme } from "../ThemeContext";
import ysongTitleWithLogo from "/ysong-logo-with-title.png";
import ysongTitleWithLogoDark from "/ysong-logo-with-title-darkmode.png";

type Props = {
    meEmail?: string | null;
    onLogout?: () => void;
    // Optional: for mobile, if you want a hamburger that toggles the sidebar
    onToggleSidebar?: () => void;
};

/**
 * In-app navbar (UI mode):
 * - Fixed height = 4rem (matches the  top-[4rem]  offset used in UI.tsx)
 * - Logo + dark/light toggle
 * - (Optional) compact user menu showing email + Sign out
 * - No Login / Create account buttons
 */
export default function UINavbar({
    meEmail,
    onLogout,
    onToggleSidebar,
}: Props) {
    const { dark, toggleDark } = useTheme();
    const [menuOpen, setMenuOpen] = useState(false);
    const menuBtnRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (menuBtnRef.current) {
            menuBtnRef.current.setAttribute(
                "aria-expanded",
                menuOpen ? "true" : "false"
            );
        }
    }, [menuOpen]);

    return (
        <header
            className="fixed inset-x-0 top-0 z-50 border-b
                 border-neutral-200/60 dark:border-neutral-800/60
                 bg-white/70 dark:bg-neutral-950/60 backdrop-blur 
                 supports-[backdrop-filter]:bg-white/60"
        >
            <nav className="mx-auto max-w-7xl h-16 px-4 sm:px-6 lg:px-8 flex items-center justify-between">
                {/* Left: logo (+ optional mobile sidebar toggle) */}
                <div className="flex items-center gap-2">
                    {onToggleSidebar && (
                        <button
                            type="button"
                            onClick={onToggleSidebar}
                            className="sm:hidden inline-flex items-center justify-center rounded-lg p-2"
                            aria-label="Toggle sidebar"
                            title="Toggle sidebar"
                        >
                            {/* hamburger */}
                            <svg
                                viewBox="0 0 24 24"
                                className="h-6 w-6"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                            >
                                <path d="M4 6h16M4 12h16M4 18h16" />
                            </svg>
                        </button>
                    )}

                    <a href="/app" aria-label="YSong Home">
                        <img
                            src={
                                dark
                                    ? ysongTitleWithLogoDark
                                    : ysongTitleWithLogo
                            }
                            alt={import.meta.env.VITE_APP_NAME}
                            className="h-8 w-auto sm:h-9"
                            loading="eager"
                            decoding="async"
                        />
                    </a>
                </div>

                <div className="flex items-center gap-1 sm:gap-2">
                    {/* Right: theme toggle + (optional) user menu 
                    <button
                        type="button"
                        onClick={toggleDark}
                        aria-label={
                            dark
                                ? "Switch to light mode"
                                : "Switch to dark mode"
                        }
                        title={dark ? "Light mode" : "Dark mode"}
                        className="inline-flex items-center justify-center rounded-lg px-2.5 py-2"
                    >
                        <span className="text-xl">{dark ? "☀️" : "🌙"}</span>
                    </button>*/}

                    {meEmail && onLogout && (
                        <div className="relative">
                            <button
                                ref={menuBtnRef}
                                type="button"
                                onClick={() => setMenuOpen((v) => !v)}
                                aria-haspopup="menu"
                                aria-controls="user-menu"
                                aria-expanded="false"
                                className="inline-flex items-center rounded-lg px-2.5 py-2 text-sm border"
                                title={meEmail}
                            >
                                <span className="hidden sm:inline max-w-[14ch] truncate">
                                    {meEmail}
                                </span>
                                <span className="sm:hidden">Account</span>
                                <svg
                                    className="ml-2 h-4 w-4"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                >
                                    <path d="M6 9l6 6 6-6" />
                                </svg>
                            </button>

                            {/* menu */}
                            {menuOpen && (
                                <div
                                    id="user-menu"
                                    role="menu"
                                    className="absolute right-0 mt-2 w-48 rounded-lg border bg-white dark:bg-neutral-950 
                             border-neutral-200 dark:border-neutral-800 shadow-lg p-2"
                                >
                                    <div className="px-2 py-1 text-xs opacity-70 truncate">
                                        {meEmail}
                                    </div>
                                    <button
                                        onClick={() => {
                                            setMenuOpen(false);
                                            onLogout();
                                        }}
                                        className="mt-1 w-full text-left px-3 py-2 text-sm rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-900"
                                        role="menuitem"
                                    >
                                        Sign out
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </nav>
        </header>
    );
}
