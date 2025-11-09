import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "../ThemeContext";

export default function SettingsPane({ tab }: { tab: any }) {
    return <SettingsCore />;
}

// ---------------- Types & constants ----------------

type Theme = "system" | "light" | "dark";

type AppSettings = {
    theme: Theme;
    saveNewChatsToCloud: boolean;
    showTimestamps: boolean;
    compactMode: boolean;
};

const DEFAULTS: AppSettings = {
    theme: "system",
    saveNewChatsToCloud: false,
    showTimestamps: true,
    compactMode: false,
};

const LS_KEY = "ysong.settings.v1";

function readSettings(): AppSettings {
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) return { ...DEFAULTS };
        return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<AppSettings>) };
    } catch {
        return { ...DEFAULTS };
    }
}

function writeSettings(s: AppSettings) {
    try {
        localStorage.setItem(LS_KEY, JSON.stringify(s));
    } catch {}
}

// ---------------- Theme sync hook ----------------

function useThemeSync(theme: Theme) {
    const mqlRef = useRef<MediaQueryList | null>(null);
    useEffect(() => {
        const root = document.documentElement;
        const apply = () => {
            const systemDark = window.matchMedia?.(
                "(prefers-color-scheme: dark)"
            )?.matches;
            const isDark =
                theme === "dark" || (theme === "system" && systemDark);
            root.classList.toggle("dark", !!isDark);
            (root.style as any).colorScheme = isDark ? "dark" : "light";
        };
        apply();

        if (theme === "system") {
            const mql = window.matchMedia("(prefers-color-scheme: dark)");
            mqlRef.current = mql;
            const handler = () => apply();
            mql.addEventListener("change", handler);
            return () => mql.removeEventListener("change", handler);
        }
    }, [theme]);
}

// ---------------- UI helpers ----------------

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
            {/* Sibling of input (the track). We use an arbitrary selector to target its child knob */}
            <span
                className="
			relative w-10 h-6 rounded-full bg-neutral-300 transition-colors
			peer-checked:bg-indigo-600
			[&>span]:transition-transform
			peer-checked:[&>span]:translate-x-4
			"
                aria-hidden
            >
                {/* Child knob (gets translated via the parent’s arbitrary selector) */}
                <span className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow" />
            </span>
        </label>
    );
}

// ---------------- Main ----------------

function SettingsCore() {
    const [settings, setSettings] = useState<AppSettings>(() => readSettings());
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        writeSettings(settings);
        // notify same-tab listeners (ChatPane) immediately
        window.dispatchEvent(
            new CustomEvent("ysong:settings", { detail: settings })
        );
    }, [settings]);

    const build = useMemo(() => {
        const env: any = (import.meta as any).env || {};
        const sha = env.VITE_BUILD_SHA || "dev";
        const time = env.VITE_BUILD_TIME || new Date().toISOString();
        const mode = env.MODE || "development";
        const api = env.VITE_API_BASE_URL || "(unset)";
        return { sha, time, mode, api } as const;
    }, []);

    const copyMeta = async () => {
        try {
            await navigator.clipboard.writeText(
                `mode=${build.mode}\nsha=${build.sha}\nbuild=${build.time}\napi=${build.api}`
            );
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
        } catch {}
    };

    return (
        <div className="h-full flex flex-col">
            {/* self-contained scroller like ChatPane */}
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
                        <DarkModeRow />
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
                                        onChange={(v) =>
                                            setSettings((s) => ({
                                                ...s,
                                                saveNewChatsToCloud: v,
                                            }))
                                        }
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
                                        onChange={(v) =>
                                            setSettings((s) => ({
                                                ...s,
                                                showTimestamps: v,
                                            }))
                                        }
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
                                        onChange={(v) =>
                                            setSettings((s) => ({
                                                ...s,
                                                compactMode: v,
                                            }))
                                        }
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
                        {/* …leave your KV + Copy buttons here … */}
                    </Section>

                    <div className="flex items-center justify-between pt-2">
                        <Button
                            onClick={() => setSettings({ ...DEFAULTS })}
                            aria-label="Reset to defaults"
                            title="Reset to defaults"
                        >
                            Reset to defaults
                        </Button>
                        <span className="text-xs text-neutral-600 dark:text-neutral-400">
                            v1 settings schema
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
}

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

function DarkModeRow() {
    const { dark, toggleDark } = useTheme();
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
                    onChange={(v) => {
                        // Only toggle if the desired state differs
                        if (v !== dark) toggleDark();
                    }}
                    title={
                        dark ? "Switch to light mode" : "Switch to dark mode"
                    }
                />
            }
        />
    );
}
