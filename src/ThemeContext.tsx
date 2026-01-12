import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { loadUserSettings, saveUserSettings } from "./lib/userPrefsApi";

type Theme = "light" | "dark";

type ThemeContextType = {
	dark: boolean;
	toggleDark: () => void;
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

function applyThemeToDocument(theme: Theme) {
	if (typeof document === "undefined") return;
	const isDark = theme === "dark";

	document.documentElement.classList.toggle("dark", isDark);
	document.documentElement.style.colorScheme = isDark ? "dark" : "light";
}

function hasAuthToken(): boolean {
	if (typeof window === "undefined") return false;
	try {
		return !!(localStorage.getItem("ys_token") || localStorage.getItem("ysong_auth_token"));
	} catch {
		return false;
	}
}

export function ThemeProvider({ children }: { children: ReactNode }) {
	// Default = dark (even before we know anything about the user)
	const [theme, setTheme] = useState<Theme>("dark");

	// 1) On mount, if logged in, hydrate from /api/settings (Neon)
	useEffect(() => {
		if (!hasAuthToken()) {
			// Logged-out: stay on default dark, no API calls
			return;
		}

		// Don’t ping authed endpoints on public pages.
		if (typeof window !== "undefined" && !window.location.pathname.startsWith("/app")) {
			return;
		}

		let cancelled = false;

		(async () => {
			try {
				const settings = await loadUserSettings();
				if (cancelled) return;
				const serverTheme = settings?.theme;
				setTheme(serverTheme === "light" || serverTheme === "dark" ? serverTheme : "dark");
			} catch {
				// 401 / network / whatever:
				// - handleError in authApi may already clear token + redirect
				// - here we just keep the default dark theme
			}
		})();

		return () => {
			cancelled = true;
		};
	}, []);

	// 2) Whenever theme changes, sync it to <html>
	useEffect(() => {
		applyThemeToDocument(theme);
	}, [theme]);

	// 3) Toggle & persist (if logged in)
	const toggleDark = () => {
		setTheme((prev) => {
			const next: Theme = prev === "dark" ? "light" : "dark";

			// Only try to persist if we appear to have a token
			if (hasAuthToken()) {
				saveUserSettings({ theme: next }).catch(() => {
					// Ignore errors; UI already flipped.
				});
			}

			return next;
		});
	};

	const dark = theme === "dark";

	return <ThemeContext.Provider value={{ dark, toggleDark }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
	const ctx = useContext(ThemeContext);
	if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
	return ctx;
}
