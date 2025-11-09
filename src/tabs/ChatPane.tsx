import { useEffect, useRef, useState } from "react";
import type { TabRecord } from "./core";
import type { Chat } from "../components/UISidebar";

type Props = {
    tab: TabRecord; // expects payload.chatId
    chats: Chat[];
    setChats: React.Dispatch<React.SetStateAction<Chat[]>>;
};

type ChatMessage = {
    role: "user" | "assistant";
    text: string;
    attachments?: { name: string; size: number; type: string }[];
    token?: string;
    ts?: number; // ← timestamp (ms)
};

export default function ChatPane({ tab, chats, setChats }: Props) {
    const showTimestamps = useShowTimestamps();
    const chatId = tab.payload?.chatId as string;
    const chat = chats.find((c) => c.id === chatId);

    const [input, setInput] = useState("");
    const [pendingFiles, setPendingFiles] = useState<File[]>([]);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const scrollerRef = useRef<HTMLDivElement | null>(null);
    const bottomRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const el = scrollerRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [chatId, chat?.messages.length]);

    if (!chat) {
        return (
            <div className="p-6 text-sm opacity-70">
                Chat not found. (It may have been deleted.)
            </div>
        );
    }

    function triggerPicker() {
        fileInputRef.current?.click();
    }
    function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
        const files = Array.from(e.target.files ?? []);
        if (!files.length) return;
        const filtered = files.filter((f) => f.size <= 50 * 1024 * 1024);
        setPendingFiles((prev) => [...prev, ...filtered]);
        e.currentTarget.value = "";
    }
    function removeAttachment(i: number) {
        setPendingFiles((prev) => prev.filter((_, idx) => idx !== i));
    }

    async function send() {
        // Re-read the chat inside the function to satisfy TS
        const current = chats.find((c) => c.id === chatId);
        if (!current) return; // chat could have been removed

        if (!input.trim() && pendingFiles.length === 0) return;

        const text = input.trim();
        const attachments =
            pendingFiles.length > 0
                ? pendingFiles.map((f) => ({
                      name: f.name,
                      size: f.size,
                      type: f.type,
                  }))
                : undefined;

        setInput("");
        setPendingFiles([]);

        const typingToken = `__typing_${crypto.randomUUID()}__`;

        // optimistic user + typing (stamp timestamps)
        setChats((prev) =>
            prev.map((c) =>
                c.id === chatId
                    ? {
                          ...c,
                          title: c.title?.trim()
                              ? c.title
                              : text
                              ? text.length > 48
                                  ? text.slice(0, 47) + "…"
                                  : text
                              : "New chat",
                          messages: [
                              ...c.messages,
                              {
                                  role: "user",
                                  text,
                                  attachments,
                                  ts: Date.now(),
                              } as any,
                              {
                                  role: "assistant",
                                  text: "…",
                                  token: typingToken,
                                  ts: Date.now(),
                              } as any,
                          ],
                      }
                    : c
            )
        );

        try {
            const baseMsgs = (current.messages ?? []).map((m: any) => ({
                role: m.role,
                content: m.text,
            }));

            const res = await fetch("https://api.ysong.ai/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    messages: baseMsgs.concat([
                        { role: "user", content: text },
                    ]),
                }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const reply = data?.reply ?? "…";

            setChats((prev) =>
                prev.map((c) =>
                    c.id === chatId
                        ? {
                              ...c,
                              messages: (c.messages as any).map((m: any) =>
                                  m.token === typingToken
                                      ? {
                                            role: "assistant",
                                            text: reply,
                                            ts: Date.now(),
                                        }
                                      : m
                              ),
                          }
                        : c
                )
            );
        } catch {
            setChats((prev) =>
                prev.map((c) =>
                    c.id === chatId
                        ? {
                              ...c,
                              messages: (c.messages as any).map((m: any) =>
                                  m.token === typingToken
                                      ? {
                                            role: "assistant",
                                            text: "⚠️ AI request failed.",
                                            ts: Date.now(),
                                        }
                                      : m
                              ),
                          }
                        : c
                )
            );
        }
    }

    return (
        <div className="h-full flex flex-col">
            {/* messages */}
            <div
                ref={scrollerRef}
                className="flex-1 min-h-0 overflow-y-auto"
                style={{ scrollbarGutter: "stable both-edges" } as any}
            >
                <div className="mx-auto w-full max-w-[720px] px-4 sm:px-6 pt-6 pb-4">
                    <div className="flex flex-col gap-4">
                        {(chat.messages as unknown as ChatMessage[]).map(
                            (m, i) => (
                                <div
                                    key={i}
                                    className={`flex ${
                                        m.role === "user"
                                            ? "justify-end"
                                            : "justify-start"
                                    }`}
                                >
                                    {/* full-width row so % max-w is measured correctly */}
                                    <div
                                        className={`flex flex-col w-full ${
                                            m.role === "user"
                                                ? "items-end"
                                                : "items-start"
                                        }`}
                                    >
                                        <div
                                            className={`rounded-2xl px-4 py-3 leading-relaxed shadow-sm
								${
                                    m.role === "user"
                                        ? "bg-neutral-700 text-white dark:bg-neutral-800"
                                        : "bg-neutral-100 dark:bg-neutral-900"
                                }
								max-w-[85%] sm:max-w-[70%]`}
                                        >
                                            {m.text}
                                            {m.attachments &&
                                                m.attachments.length > 0 && (
                                                    <div className="mt-2 text-xs opacity-80">
                                                        📎 Attachments:
                                                        <ul className="mt-1 space-y-0.5">
                                                            {m.attachments.map(
                                                                (a, j) => (
                                                                    <li
                                                                        key={j}
                                                                        className="truncate"
                                                                    >
                                                                        {a.name}{" "}
                                                                        <span className="opacity-60">
                                                                            (
                                                                            {a.type ||
                                                                                "file"}
                                                                            )
                                                                        </span>
                                                                    </li>
                                                                )
                                                            )}
                                                        </ul>
                                                    </div>
                                                )}
                                        </div>

                                        {showTimestamps && (
                                            <div className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                                                <time
                                                    dateTime={new Date(
                                                        m.ts ?? Date.now()
                                                    ).toISOString()}
                                                    title={new Date(
                                                        m.ts ?? Date.now()
                                                    ).toLocaleString()}
                                                >
                                                    {formatTime(
                                                        m.ts ?? Date.now()
                                                    )}
                                                </time>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )
                        )}

                        <div ref={bottomRef} />
                    </div>
                </div>
            </div>

            {/* composer */}
            <div className="border-t border-neutral-200 dark:border-neutral-800">
                {pendingFiles.length > 0 && (
                    <div className="mx-auto w-full max-w-[720px] px-4 sm:px-6 pt-3 flex flex-wrap gap-2">
                        {pendingFiles.map((f, idx) => (
                            <span
                                key={idx}
                                className="inline-flex items-center gap-2 text-xs px-2 py-1 rounded-full border border-neutral-300 dark:border-neutral-700"
                            >
                                <span className="truncate max-w-[14rem]">
                                    {f.name}
                                </span>
                                <button
                                    onClick={() => removeAttachment(idx)}
                                    className="opacity-70 hover:opacity-100"
                                    aria-label={`Remove ${f.name}`}
                                    title="Remove"
                                >
                                    ✕
                                </button>
                            </span>
                        ))}
                    </div>
                )}

                <div className="mx-auto w-full max-w-[720px] px-4 sm:px-6 py-4 pb-[env(safe-area-inset-bottom)]">
                    <div className="flex items-center gap-2">
                        <label
                            htmlFor={`filePicker-${chatId}`}
                            className="sr-only"
                        >
                            Add files
                        </label>

                        <button
                            type="button"
                            onClick={triggerPicker}
                            className="shrink-0 h-10 w-10 rounded-lg border flex items-center justify-center"
                            title="Add files"
                            aria-label="Add files"
                        >
                            +
                        </button>

                        <input
                            id={`filePicker-${chatId}`}
                            ref={fileInputRef}
                            type="file"
                            multiple
                            onChange={onPickFiles}
                            accept="audio/*,image/*,.txt,.md,.lrc,.lyr,.rtf,.json"
                            className="hidden"
                        />

                        <input
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && send()}
                            placeholder={`Message ${
                                import.meta.env.VITE_APP_NAME
                            }…`}
                            className="flex-1 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-neutral-500/40"
                        />

                        <button
                            onClick={send}
                            className="px-4 py-2 rounded-lg border"
                            aria-label="Send message"
                        >
                            Send
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

/* ---------- Settings integration ---------- */

function useShowTimestamps() {
    const read = () => {
        try {
            const raw = localStorage.getItem("ysong.settings.v1");
            const obj = raw ? JSON.parse(raw) : {};
            return obj.showTimestamps ?? true; // default true
        } catch {
            return true;
        }
    };

    const [flag, setFlag] = useState<boolean>(read);

    useEffect(() => {
        // same-tab updates from SettingsPane (dispatches ysong:settings)
        const onSettings = (e: Event) => {
            const detail = (e as CustomEvent<any>).detail;
            if (detail && typeof detail.showTimestamps === "boolean") {
                setFlag(!!detail.showTimestamps);
            }
        };
        window.addEventListener("ysong:settings", onSettings as EventListener);

        // cross-tab updates via localStorage
        const onStorage = (e: StorageEvent) => {
            if (e.key === "ysong.settings.v1" && e.newValue) {
                try {
                    const obj = JSON.parse(e.newValue);
                    if ("showTimestamps" in obj) setFlag(!!obj.showTimestamps);
                } catch {}
            }
        };
        window.addEventListener("storage", onStorage);

        return () => {
            window.removeEventListener(
                "ysong:settings",
                onSettings as EventListener
            );
            window.removeEventListener("storage", onStorage);
        };
    }, []);

    return flag;
}

/* ---------- Helpers ---------- */

function formatTime(input: number) {
    const d = new Date(input);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
