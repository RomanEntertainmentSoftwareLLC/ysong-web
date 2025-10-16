import { useEffect, useRef, useState } from "react";
import { useTheme } from "../ThemeContext";
import { useNavigate } from "react-router-dom";
import ysongTitleWithLogo from "/ysong-logo-with-title.png";
import ysongTitleWithLogoDark from "/ysong-logo-with-title-darkmode.png";

export default function Navbar() {
    const { dark, toggleDark } = useTheme();
    const [open, setOpen] = useState(false);
    const btnRef = useRef<HTMLButtonElement>(null);
    const navigate = useNavigate();

    // Keep axe happy: update aria-expanded after render with a string token
    useEffect(() => {
        if (btnRef.current) {
            btnRef.current.setAttribute(
                "aria-expanded",
                open ? "true" : "false"
            );
        }
    }, [open]);

    return (
        /* Navigation Bar */
        <header
            className="fixed inset-x-0 top-0 z-50 border-b
				border-neutral-200/60 dark:border-neutral-800/60
				bg-white/70 dark:bg-neutral-950/60 backdrop-blur 
				supports-[backdrop-filter]:bg-white/60"
        >
            <nav className="mx-auto max-w-7xl h-16 px-4 sm:px-6 lg:px-8 flex items-center justify-between">
                {/* Left: Logo */}
                <a href="/" aria-label="ysong Home">
                    <img
                        src={dark ? ysongTitleWithLogoDark : ysongTitleWithLogo}
                        alt="ysong"
                        className="h-8 w-auto sm:h-9"
                        loading="eager"
                    />
                </a>

                {/* Right (desktop) */}
                <div className="hidden sm:flex items-center gap-2">
                    {/* Login Button */}
                    <button
                        type="button"
                        onClick={() => navigate("/login")}
                        className="px-3 py-2 text-sm font-medium rounded-lg border"
                    >
                        Log in
                    </button>
                    {/* Create Account Button*/}
                    <button
                        type="button"
                        onClick={() => navigate("/signup")}
                        className="px-3.5 py-2 text-sm font-medium rounded-lg border"
                    >
                        Create account
                    </button>

                    {/* Theme toggle */}
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
                    </button>
                </div>

                {/* If the website is in mobile mode...*/}
                {/* Mobile: hamburger */}
                <div className="sm:hidden">
                    <button
                        id="mobile-menu-button"
                        ref={btnRef}
                        type="button"
                        onClick={() => setOpen((v) => !v)}
                        aria-haspopup="menu"
                        aria-controls="mobile-menu"
                        aria-expanded="false" // literal; updated via useEffect
                        className="inline-flex items-center justify-center rounded-lg p-2"
                    >
                        <span className="sr-only">Toggle menu</span>
                        {/* hamburger / close */}
                        <svg
                            className={`${open ? "hidden" : "block"} h-6 w-6`}
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                        >
                            <path d="M4 6h16M4 12h16M4 18h16" />
                        </svg>
                        <svg
                            className={`${open ? "block" : "hidden"} h-6 w-6`}
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                        >
                            <path d="M6 6l12 12M6 18L18 6" />
                        </svg>
                    </button>
                </div>
            </nav>

            {/* Mobile panel */}
            <div
                id="mobile-menu"
                role="menu"
                aria-labelledby="mobile-menu-button"
                aria-hidden={open ? "false" : "true"}
                hidden={!open}
                className="sm:hidden px-4 pb-3"
            >
                <div className="mt-2 flex flex-col items-stretch gap-2">
                    {/* Mobile Login Button*/}
                    <button
                        type="button"
                        onClick={() => navigate("/login")}
                        className="px-3 py-2 text-sm font-medium rounded-lg border"
                    >
                        Log in
                    </button>
                    {/* Mobile Create Account Button*/}
                    <button
                        type="button"
                        onClick={() => navigate("/signup")}
                        className="px-3.5 py-2 text-sm font-medium rounded-lg border"
                    >
                        Create account
                    </button>

                    <button
                        type="button"
                        onClick={() => {
                            toggleDark();
                            setOpen(false);
                        }}
                        className="mt-1 inline-flex items-center justify-center rounded-lg px-3 py-2"
                    >
                        {dark ? "☀️ Light mode" : "🌙 Dark mode"}
                    </button>
                </div>
            </div>
        </header>
    );
}
