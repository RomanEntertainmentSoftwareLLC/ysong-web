// src/components/SettingsPane.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useTheme } from "../ThemeContext";
import {
    loadUserSettings,
    saveUserSettings,
    type UserSettingsResponse,
} from "../lib/userPrefsApi";
import { setSaveChatsFlag } from "../lib/settings";

/* ---------------- Entry ---------------- */
export default function SettingsPane() {
    return <SettingsCore />;
}

/* ---------------- Types & constants ---------------- */
type Theme = "light" | "dark";

type AppSettings = {
    theme: Theme;
    saveNewChatsToCloud: boolean;
    showTimestamps: boolean;
    compactMode: boolean;
};

const DEFAULTS: AppSettings = {
    theme: "dark",
    saveNewChatsToCloud: true,
    showTimestamps: true,
    compactMode: false,
};

/* ---------- Global in-memory cache so settings survive tab switches ---------- */

let cachedSettings: AppSettings | null = null;
let settingsFetchedFromServer = false;

declare global {
    interface Window {
        __YS_SETTINGS?: AppSettings;
    }
}

function getInitialSettings(): AppSettings {
    // 1) If UI.tsx already hydrated settings on login, use those.
    if (typeof window !== "undefined" && window.__YS_SETTINGS) {
        return window.__YS_SETTINGS;
    }

    // 2) If this tab already fetched settings once, reuse them.
    if (cachedSettings) return cachedSettings;

    // 3) Cold start: fall back to defaults until the server responds.
    return DEFAULTS;
}

/* ---------------- UI helpers ---------------- */

function Section({
    title,
    subtitle,
    children,
}: {
    title: string;
    subtitle?: string;
    children?: React.ReactNode;
}) {
    return (
        <section className="border rounded-2xl p-4 md:p-5 bg-white/80 dark:bg-neutral-900/60 border-neutral-200 dark:border-neutral-800 shadow-sm">
            <header className="mb-3">
                <h2 className="text-lg font-semibold">{title}</h2>
                {subtitle ? (
                    <p className="text-sm text-neutral-600 dark:text-neutral-400">
                        {subtitle}
                    </p>
                ) : null}
            </header>
            {children}
        </section>
    );
}

function Row({
    label,
    description,
    right,
    htmlFor,
}: {
    label: string;
    description?: string;
    right: React.ReactNode;
    htmlFor?: string;
}) {
    return (
        <div className="flex items-start justify-between gap-4 py-3">
            <div>
                {htmlFor ? (
                    <label
                        htmlFor={htmlFor}
                        className="font-medium leading-none cursor-pointer"
                    >
                        {label}
                    </label>
                ) : (
                    <div className="font-medium leading-none">{label}</div>
                )}
                {description ? (
                    <div className="text-sm text-neutral-600 dark:text-neutral-400 mt-1 max-w-prose">
                        {description}
                    </div>
                ) : null}
            </div>
            <div className="shrink-0">{right}</div>
        </div>
    );
}

function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
    const { className = "", ...rest } = props;
    return (
        <button
            {...rest}
            className={
                "inline-flex items-center justify-center rounded-lg border px-3 py-1.5 text-sm " +
                "bg-white hover:bg-neutral-50 border-neutral-300 text-neutral-800 " +
                "dark:bg-neutral-900 dark:hover:bg-neutral-800 dark:border-neutral-700 dark:text-neutral-100 " +
                className
            }
        />
    );
}

function SmallSwitch({
    checked,
    onChange,
    id,
    ariaLabel,
    title,
}: {
    checked: boolean;
    onChange: (v: boolean) => void;
    id?: string;
    ariaLabel: string;
    title?: string;
}) {
    return (
        <label
            className="inline-flex items-center cursor-pointer select-none"
            title={title || ariaLabel}
        >
            <input
                id={id}
                type="checkbox"
                className="sr-only peer"
                checked={checked}
                onChange={(e) => onChange(e.currentTarget.checked)}
                aria-label={ariaLabel}
            />
            <span
                className="
          relative w-10 h-6 rounded-full bg-neutral-300 transition-colors
          peer-checked:bg-indigo-600
          [&>span]:transition-transform
          peer-checked:[&>span]:translate-x-4
        "
                aria-hidden
            >
                <span className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow" />
            </span>
        </label>
    );
}

/* ---------------- Main ---------------- */

function SettingsCore() {
    const [settings, setSettings] = useState<AppSettings>(() => {
        const initial = getInitialSettings();
        // keep cache + window in sync even on first mount
        cachedSettings = initial;
        if (typeof window !== "undefined") {
            window.__YS_SETTINGS = initial;
        }
        return initial;
    });

    const [loadedFromServer, setLoadedFromServer] = useState(false);

    // ThemeContext boolean
    const { dark, toggleDark } = useTheme();

    // Helper: update React state + global cache in one go
    const syncSettings = (updater: (prev: AppSettings) => AppSettings) => {
        setSettings((prev) => {
            const next = updater(prev);
            cachedSettings = next;
            if (typeof window !== "undefined") {
                window.__YS_SETTINGS = next;
            }
            return next;
        });
    };

    // ---------- Load from Neon on mount ----------
    useEffect(() => {
        let cancelled = false;

        (async () => {
            try {
                let next: AppSettings;

                if (settingsFetchedFromServer && cachedSettings) {
                    // We already fetched settings once in this tab → reuse them.
                    next = cachedSettings;
                } else {
                    const s: UserSettingsResponse = await loadUserSettings();
                    if (cancelled) return;

                    next = {
                        theme:
                            (s.theme ?? "dark") === "light" ? "light" : "dark",
                        saveNewChatsToCloud: s.saveChats ?? true,
                        showTimestamps:
                            s.showTimestamps === undefined
                                ? true
                                : !!s.showTimestamps,
                        compactMode:
                            s.compactMode === undefined
                                ? false
                                : !!s.compactMode,
                    };

                    // Persist to in-memory cache + window so other tabs/hooks see it
                    cachedSettings = next;
                    settingsFetchedFromServer = true;
                    if (typeof window !== "undefined") {
                        window.__YS_SETTINGS = next;
                    }
                }

                setSettings(next);

                // sync ThemeContext with the stored theme
                const shouldBeDark = next.theme === "dark";
                if (shouldBeDark !== dark) toggleDark();

                // keep legacy flag for UI that still looks at it
                setSaveChatsFlag(next.saveNewChatsToCloud);
            } catch (err) {
                console.error("fetchUserSettings failed", err);
                // keep whatever we already had on error
            } finally {
                if (!cancelled) setLoadedFromServer(true);
            }
        })();

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ---------- Save to Neon whenever settings change ----------

    useEffect(() => {
        if (!loadedFromServer) return;

        const t = setTimeout(() => {
            // Push to server
            saveUserSettings({
                saveChats: settings.saveNewChatsToCloud,
                theme: settings.theme,
                showTimestamps: settings.showTimestamps,
                compactMode: settings.compactMode,
            }).catch((err) => {
                console.error("updateUserSettings failed", err);
            });

            // Keep in-memory cache and global window copy in sync
            cachedSettings = settings;
            if (typeof window !== "undefined") {
                window.__YS_SETTINGS = settings;
            }

            // keep legacy flag in sync for the rest of the app
            setSaveChatsFlag(settings.saveNewChatsToCloud);
        }, 250);

        return () => clearTimeout(t);
    }, [
        loadedFromServer,
        settings.saveNewChatsToCloud,
        settings.theme,
        settings.showTimestamps,
        settings.compactMode,
    ]);

    // ---------- Broadcast to other tabs (ChatPane) ----------
    useEffect(() => {
        window.dispatchEvent(
            new CustomEvent("ysong:settings", { detail: settings })
        );
    }, [settings]);

    // ---------- Build meta ----------
    const build = useMemo(() => {
        const env: any = (import.meta as any).env || {};
        const sha = env.VITE_BUILD_SHA || "dev";
        const time = env.VITE_BUILD_TIME || new Date().toISOString();
        const mode = env.MODE || "development";
        const api = env.VITE_AUTH_API_URL || env.VITE_API_BASE_URL || "(unset)";
        return { sha, time, mode, api } as const;
    }, []);

    // ---------- Render ----------
    return (
        <div className="h-full flex flex-col">
            <div
                className="flex-1 min-h-0 overflow-y-auto"
                style={{ scrollbarGutter: "stable both-edges" } as any}
            >
                <div className="p-4 md:p-6 lg:p-8 mx-auto max-w-3xl space-y-6 pb-16">
                    <header className="flex items-center gap-3">
                        <div
                            className="rounded-2xl bg-indigo-500/10 p-2"
                            aria-hidden
                        >
                            ⚙️
                        </div>
                        <div>
                            <h1 className="text-2xl font-semibold tracking-tight">
                                Settings
                            </h1>
                            <p className="text-neutral-600 dark:text-neutral-400">
                                Tune YSong to your liking. Changes save
                                automatically.
                            </p>
                        </div>
                    </header>

                    <Section
                        title="Appearance"
                        subtitle="Choose how YSong looks on your device."
                    >
                        <DarkModeRow
                            dark={dark}
                            onToggle={(v) => {
                                if (v !== dark) toggleDark();
                                syncSettings((s) => ({
                                    ...s,
                                    theme: v ? "dark" : "light",
                                }));
                            }}
                        />
                    </Section>

                    <Section
                        title="Chat"
                        subtitle="Behavior and layout for conversations."
                    >
                        <div className="space-y-2">
                            <Row
                                label="Save new chats to cloud"
                                description="Stores new conversations to your account automatically so they appear across devices."
                                right={
                                    <SmallSwitch
                                        id="settings-save-cloud"
                                        ariaLabel="Save new chats to cloud"
                                        checked={settings.saveNewChatsToCloud}
                                        onChange={(v) => {
                                            // Update local React state + cache
                                            syncSettings((s) => ({
                                                ...s,
                                                saveNewChatsToCloud: v,
                                            }));

                                            // Immediately persist to Neon (like dark mode)
                                            saveUserSettings({
                                                saveChats: v,
                                            }).catch((err) => {
                                                console.error(
                                                    "saveUserSettings(saveChats) failed",
                                                    err
                                                );
                                            });
                                        }}
                                    />
                                }
                                htmlFor="settings-save-cloud"
                            />
                            <div className="h-px bg-neutral-200 dark:bg-neutral-800" />
                            <Row
                                label="Show message timestamps"
                                description="Display the time beside each message in the chat thread."
                                right={
                                    <SmallSwitch
                                        id="settings-timestamps"
                                        ariaLabel="Show message timestamps"
                                        checked={settings.showTimestamps}
                                        onChange={(v) => {
                                            // Update local React state + cache
                                            syncSettings((s) => ({
                                                ...s,
                                                showTimestamps: v,
                                            }));

                                            // Immediately persist to Neon
                                            saveUserSettings({
                                                showTimestamps: v,
                                            }).catch((err) => {
                                                console.error(
                                                    "saveUserSettings(showTimestamps) failed",
                                                    err
                                                );
                                            });
                                        }}
                                    />
                                }
                                htmlFor="settings-timestamps"
                            />
                            <div className="h-px bg-neutral-200 dark:bg-neutral-800" />
                            <Row
                                label="Compact mode"
                                description="Reduce vertical spacing in the chat UI to fit more on screen."
                                right={
                                    <SmallSwitch
                                        id="settings-compact"
                                        ariaLabel="Compact mode"
                                        checked={settings.compactMode}
                                        onChange={(v) => {
                                            // Update local state + cache
                                            syncSettings((s) => ({
                                                ...s,
                                                compactMode: v,
                                            }));

                                            // Persist immediately
                                            saveUserSettings({
                                                compactMode: v,
                                            }).catch((err) => {
                                                console.error(
                                                    "saveUserSettings(compactMode) failed",
                                                    err
                                                );
                                            });
                                        }}
                                    />
                                }
                                htmlFor="settings-compact"
                            />
                        </div>
                    </Section>

                    <Section
                        title="About"
                        subtitle="Build details useful for debugging and support."
                    >
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <KV label="Mode" value={build.mode} />
                            <KV label="API Base" value={build.api} />
                            <KV label="Build SHA" value={build.sha} />
                            <KV label="Build Time" value={build.time} />
                        </div>
                    </Section>

                    <div className="flex items-center justify-between pt-2">
                        <Button
                            onClick={() =>
                                syncSettings(() => ({ ...DEFAULTS }))
                            }
                            aria-label="Reset to defaults"
                            title="Reset to defaults"
                        >
                            Reset to defaults
                        </Button>
                        <span className="text-xs text-neutral-600 dark:text-neutral-400">
                            Neon-backed settings
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
}

/* ---------------- Small bits ---------------- */

function KV({
    label,
    value,
    copyable,
}: {
    label: string;
    value: string;
    copyable?: boolean;
}) {
    return (
        <div className="rounded-xl border bg-white/70 dark:bg-neutral-900/60 text-neutral-800 dark:text-neutral-100 border-neutral-200 dark:border-neutral-800 p-3">
            <div className="text-xs text-neutral-600 dark:text-neutral-400 mb-1">
                {label}
            </div>
            <div className="flex items-center justify-between gap-2">
                <span className="font-medium truncate" title={value}>
                    {value}
                </span>
                {copyable ? <CopyButton text={value} /> : null}
            </div>
        </div>
    );
}

function CopyButton({ text }: { text: string }) {
    const [ok, setOk] = useState(false);
    return (
        <button
            className={`text-sm underline underline-offset-2 ${
                ok
                    ? "text-green-600 dark:text-green-400"
                    : "text-indigo-600 dark:text-indigo-300"
            }`}
            onClick={async () => {
                try {
                    await navigator.clipboard.writeText(text);
                    setOk(true);
                    setTimeout(() => setOk(false), 900);
                } catch {}
            }}
            title="Copy"
            aria-label="Copy value"
        >
            {ok ? "Copied" : "Copy"}
        </button>
    );
}

function DarkModeRow({
    dark,
    onToggle,
}: {
    dark: boolean;
    onToggle: (v: boolean) => void;
}) {
    return (
        <Row
            label="Dark mode"
            description="Use a dark color scheme for the UI."
            htmlFor="settings-dark"
            right={
                <SmallSwitch
                    id="settings-dark"
                    ariaLabel="Dark mode"
                    checked={dark}
                    onChange={onToggle}
                    title={
                        dark ? "Switch to light mode" : "Switch to dark mode"
                    }
                />
            }
        />
    );
}
