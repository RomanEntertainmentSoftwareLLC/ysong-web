// src/components/UISidebar.tsx
import { useState, useEffect } from "react";
import { getSaveChatsFlag, setSaveChatsFlag } from "../lib/settings";

export type Chat = {
    id: string;
    title?: string; // optional
    messages: { role: "user" | "assistant"; text: string }[];
};

type Props = {
    chats: Chat[];
    activeId: string;
    setActiveId: (id: string) => void;
    newChat: () => void;
    meEmail?: string | null;
    onLogout?: () => void;
};

function normalizeOneLine(s: string) {
    return s.replace(/\s+/g, " ").trim();
}
function truncate(s: string, max = 48) {
    return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
function chatLabel(chat: Chat): string {
    const t = normalizeOneLine(chat.title ?? "");
    if (t) return t;
    const last = chat.messages[chat.messages.length - 1]?.text ?? "";
    const normalized = normalizeOneLine(last);
    return normalized || "New chat";
}

export default function UISidebar({
    chats,
    activeId,
    setActiveId,
    newChat,
    meEmail,
    onLogout,
}: Props) {
    const [settingsOpen, setSettingsOpen] = useState(false);

    return (
        <aside
            className="h-full w-[15%] min-w-[220px] max-w-[320px] border-r
                 border-neutral-200 dark:border-neutral-800 p-4 space-y-3
                 flex flex-col min-h-0"
        >
            {/* Header: account + settings (sticky) */}
            <div
                className="sticky top-0 z-10 -mt-4 px-4 pt-4 pb-3
                   bg-white/90 dark:bg-neutral-950/90 backdrop-blur
                   border-b border-neutral-200 dark:border-neutral-800 rounded-t-lg"
            >
                <div className="text-[10px] uppercase tracking-wide opacity-60">
                    Signed in as
                </div>
                <div className="truncate font-medium" title={meEmail || ""}>
                    {meEmail || "…"}
                </div>
                <div className="mt-2 flex items-center gap-2">
                    <button
                        onClick={newChat}
                        className="text-sm px-2 py-1 rounded-lg border
                       border-neutral-300 dark:border-neutral-700
                       hover:bg-neutral-50 dark:hover:bg-neutral-900"
                    >
                        New
                    </button>

                    <button
                        onClick={() => setSettingsOpen(true)}
                        className="text-xs px-3 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700
                       hover:bg-neutral-50 dark:hover:bg-neutral-900"
                        aria-haspopup="dialog"
                    >
                        Settings
                    </button>

                    {onLogout && (
                        <button
                            onClick={onLogout}
                            className="ml-auto text-xs text-rose-600 hover:underline"
                        >
                            Sign out
                        </button>
                    )}
                </div>
            </div>

            {/* Chats label */}
            <div className="flex items-center justify-between mt-2">
                <h2 className="font-semibold">Chats</h2>
            </div>

            {/* Chat listbox: exactly 5 visible rows */}
            <div className="mt-2">
                {/* 5 rows * 44px + ~12px gaps ≈ 232px */}
                <div className="max-h-[232px] overflow-y-auto pr-1">
                    <div className="space-y-1">
                        {chats.map((c) => {
                            const fallbackFromUser = c.messages?.find(
                                (m: any) => m.role === "user"
                            )?.text;
                            const fallbackAny = c.messages?.[0]?.text;
                            const raw =
                                c.title?.trim?.() ||
                                "" ||
                                fallbackFromUser?.trim?.() ||
                                "" ||
                                fallbackAny?.trim?.() ||
                                "" ||
                                "New chat";

                            const primary =
                                raw.length > 48 ? raw.slice(0, 47) + "…" : raw;

                            return (
                                <button
                                    key={c.id}
                                    onClick={() => setActiveId(c.id)}
                                    className={`w-full text-left px-3 rounded-lg border h-11 flex items-center ${
                                        c.id === activeId
                                            ? "bg-neutral-100 dark:bg-neutral-900"
                                            : "hover:bg-neutral-50 dark:hover:bg-neutral-900"
                                    }`}
                                    title={raw}
                                >
                                    <div className="truncate">{primary}</div>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            {settingsOpen && (
                <SettingsModal onClose={() => setSettingsOpen(false)} />
            )}
        </aside>
    );
}

/* Minimal modal with the Save-to-cloud toggle (no legal/ToS links here) */
function SettingsModal({ onClose }: { onClose: () => void }) {
    const [enabled, setEnabled] = useState(false);

    useEffect(() => setEnabled(getSaveChatsFlag()), []);

    return (
        <div
            role="dialog"
            aria-modal
            className="fixed inset-0 z-[1000] grid place-items-center bg-black/60 p-4"
            onClick={onClose} // close on backdrop
            onKeyDown={(e) => e.key === "Escape" && onClose()}
        >
            <div
                className="w-full max-w-md rounded-2xl bg-neutral-900 p-6"
                onClick={(e) => e.stopPropagation()} // keep clicks inside
            >
                <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold">Settings</h2>
                    <button
                        onClick={onClose}
                        className="rounded-md px-2 py-1 bg-neutral-800 hover:bg-neutral-700"
                    >
                        Close
                    </button>
                </div>

                <div className="mt-4 space-y-5">
                    <div>
                        <div className="text-xs uppercase opacity-60 mb-1">
                            Chat
                        </div>
                        <label className="flex items-center justify-between gap-4">
                            <span className="text-sm">
                                Save new chats to cloud
                            </span>
                            <input
                                type="checkbox"
                                checked={enabled}
                                onChange={(e) => {
                                    const v = e.target.checked;
                                    setEnabled(v);
                                    setSaveChatsFlag(v); // persists to localStorage
                                }}
                            />
                        </label>
                    </div>
                </div>
            </div>
        </div>
    );
}
