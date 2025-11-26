import { useEffect, useRef, useState } from "react";
import type { TabRecord } from "./core";
import type { Chat } from "../components/UISidebar";
import { fetchChatMessages, appendMessage } from "../lib/chatApi";
import { YSONG_SYSTEM_PROMPT } from "../lib/ysongPersona";

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
    ts?: number; // timestamp (ms)
};

export default function ChatPane({ tab, chats, setChats }: Props) {
    const showTimestamps = useShowTimestamps();
    const chatId = tab.payload?.chatId as string;
    const chat = chats.find((c) => c.id === chatId);
    // messages can be missing when we only have the chat shell from /api/chats
    const messageCount = chat?.messages?.length ?? 0;

    const [input, setInput] = useState("");

    const [pendingFiles, setPendingFiles] = useState<File[]>([]);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);

    const scrollerRef = useRef<HTMLDivElement | null>(null);
    const bottomRef = useRef<HTMLDivElement | null>(null);

    // Auto-resize textarea
    useEffect(() => {
        const el = textareaRef.current;
        if (!el) return;

        el.style.height = "0px";
        el.style.height = el.scrollHeight + "px";
    }, [input]);

    // ---- Load messages for this chat from Neon when the chat opens / changes ----
    useEffect(() => {
        if (!chatId) return;
        let cancelled = false;

        (async () => {
            try {
                const dbMessages = await fetchChatMessages(chatId);
                if (cancelled) return;

                setChats((prev) =>
                    prev.map((c) =>
                        c.id === chatId
                            ? {
                                  ...c,
                                  messages: dbMessages.map((m) => ({
                                      role: m.role,
                                      text: m.content,
                                      attachments: m.attachments ?? undefined,
                                      ts: m.createdAt
                                          ? new Date(m.createdAt).getTime()
                                          : Date.now(),
                                  })),
                              }
                            : c
                    )
                );
            } catch (e: any) {
                // ignore "chat_not_found" for empty/new chats
                if (e?.message === "chat_not_found") {
                    return;
                }
                console.error("Failed to load messages for chat", chatId, e);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [chatId, setChats]);

    // Keep scroll pinned to bottom when messages change
    useEffect(() => {
        const el = scrollerRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [chatId, messageCount]);

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
        // Re-read the chat inside the function to satisfy TS & get latest messages
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

        // Optimistic user message + typing bubble (with timestamps)
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
                              ...(Array.isArray(c.messages)
                                  ? (c.messages as any[])
                                  : []),
                              {
                                  role: "user",
                                  text,
                                  attachments,
                                  ts: Date.now(),
                              } as ChatMessage,
                              {
                                  role: "assistant",
                                  text: "…",
                                  token: typingToken,
                                  ts: Date.now(),
                              } as ChatMessage,
                          ],
                      }
                    : c
            )
        );

        try {
            // 1) Persist the user message to Neon (fire-and-forget style)
            try {
                await appendMessage(chatId, {
                    role: "user",
                    content: text,
                    attachments,
                });
            } catch (e) {
                console.error("Failed to save user message to Neon", e);
            }

            // 2) Build the message history to send to the AI endpoint
            const baseMsgs = (current.messages ?? []).map((m: any) => ({
                role: m.role,
                content: m.text,
            }));

            const res = await fetch("https://api.ysong.ai/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    messages: [
                        { role: "system", content: YSONG_SYSTEM_PROMPT },
                        ...baseMsgs,
                        { role: "user", content: text },
                    ],
                }),
            });

            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const reply = data?.reply ?? "…";

            // 3) Persist the assistant reply to Neon
            try {
                await appendMessage(chatId, {
                    role: "assistant",
                    content: reply,
                });
            } catch (e) {
                console.error("Failed to save assistant message to Neon", e);
            }

            // 4) Replace the typing bubble with the final assistant reply
            setChats((prev) =>
                prev.map((c) =>
                    c.id === chatId
                        ? {
                              ...c,
                              messages: (Array.isArray(c.messages)
                                  ? (c.messages as any[])
                                  : []
                              ).map((m: any) =>
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
            // AI request failed → swap typing bubble with error message
            setChats((prev) =>
                prev.map((c) =>
                    c.id === chatId
                        ? {
                              ...c,
                              messages: (Array.isArray(c.messages)
                                  ? (c.messages as any[])
                                  : []
                              ).map((m: any) =>
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
                        {(Array.isArray(chat.messages)
                            ? (chat.messages as unknown as ChatMessage[])
                            : []
                        ).map((m, i) => (
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

                                    {showTimestamps && m.ts != null && (
                                        <div className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                                            <time
                                                dateTime={new Date(
                                                    m.ts
                                                ).toISOString()}
                                                title={new Date(
                                                    m.ts
                                                ).toLocaleString()}
                                            >
                                                {formatTime(m.ts)}
                                            </time>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}

                        <div ref={bottomRef} />
                    </div>
                </div>
            </div>

            {/* composer */}
            <div className="border-t border-neutral-200 dark:border-neutral-800">
                {/* Attachment chips (only if there are pending files) */}
                {pendingFiles.length > 0 && (
                    <div className="mx-auto w-full max-w-[720px] px-4 sm:px-6 pt-3 flex flex-wrap gap-3">
                        {pendingFiles.map((f, idx) => {
                            const isAudio = f.type.startsWith("audio/");
                            const sizeMB = (f.size / (1024 * 1024)).toFixed(1);

                            return (
                                <div
                                    key={idx}
                                    className="flex items-center gap-3 rounded-2xl border border-neutral-300 bg-neutral-50/90 px-3 py-2 text-xs sm:text-sm shadow-sm
                                        dark:border-neutral-700 dark:bg-neutral-900/70"
                                >
                                    {/* Icon + mini waveform for audio */}
                                    <div className="flex flex-col items-center justify-center">
                                        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-neutral-200 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-50">
                                            {isAudio ? "🎵" : "📎"}
                                        </div>
                                        {isAudio && (
                                            <div className="mt-1 flex h-4 items-end gap-[2px] text-[0]">
                                                {Array.from({ length: 12 }).map(
                                                    (_, barIdx) => (
                                                        <span
                                                            key={barIdx}
                                                            className="flex-1 rounded-full bg-neutral-400/80 dark:bg-neutral-500/80"
                                                            style={{
                                                                height: `${
                                                                    4 +
                                                                    ((barIdx *
                                                                        7) %
                                                                        10)
                                                                }px`,
                                                            }}
                                                        />
                                                    )
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {/* File meta */}
                                    <div className="min-w-0 flex flex-col">
                                        <span className="truncate max-w-[10rem] font-medium">
                                            {f.name}
                                        </span>
                                        <span className="mt-0.5 text-[10px] uppercase tracking-wide opacity-70">
                                            {isAudio
                                                ? "Audio file"
                                                : "Attachment"}{" "}
                                            · {sizeMB} MB
                                        </span>
                                    </div>

                                    {/* Remove button */}
                                    <button
                                        type="button"
                                        onClick={() => removeAttachment(idx)}
                                        className="ml-1 rounded-full px-2 text-xs opacity-60 hover:bg-neutral-200 hover:opacity-100 dark:hover:bg-neutral-700"
                                        aria-label={`Remove ${f.name}`}
                                        title="Remove"
                                    >
                                        ✕
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Main input bar (always visible) */}
                <div className="mx-auto w-full max-w-[720px] px-4 sm:px-6 py-4 pb-[env(safe-area-inset-bottom)]">
                    <div className="flex items-center">
                        {/* Screen-reader label for the hidden file input */}
                        <label
                            htmlFor={`filePicker-${chatId}`}
                            className="sr-only"
                        >
                            Add files
                        </label>

                        {/* Unified pill */}
                        <div className="flex w-full items-center gap-1 rounded-2xl border border-neutral-300 bg-neutral-50/80 px-2 py-1.5 dark:border-neutral-700 dark:bg-neutral-900/60">
                            {/* Upload / [+] button */}
                            <button
                                type="button"
                                onClick={triggerPicker}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-transparent text-neutral-500 hover:bg-neutral-200/60 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-700/60 dark:hover:text-neutral-50"
                                title="Add files"
                                aria-label="Add files"
                            >
                                +
                            </button>

                            {/* Hidden file input */}
                            <input
                                id={`filePicker-${chatId}`}
                                name="files"
                                ref={fileInputRef}
                                type="file"
                                multiple
                                onChange={onPickFiles}
                                accept="audio/*,image/*,.txt,.md,.lrc,.lyr,.rtf,.json"
                                className="hidden"
                            />

                            {/* Text input (multi-line, auto-growing) */}
                            <textarea
                                id={`chat-input-${chatId}`}
                                name="message"
                                ref={textareaRef}
                                value={input}
                                rows={1}
                                autoComplete="off"
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && !e.shiftKey) {
                                        e.preventDefault(); // prevent a newline
                                        send();
                                    }
                                }}
                                placeholder={`Message ${
                                    import.meta.env.VITE_APP_NAME
                                }…`}
                                className="flex-1 bg-transparent border-0 px-2 py-1 text-sm sm:text-base
                                    leading-relaxed resize-none overflow-y-auto max-h-40
                                    focus:outline-none focus:ring-0"
                            />

                            {/* Send button */}
                            <button
                                type="button"
                                onClick={send}
                                disabled={
                                    !input.trim() && pendingFiles.length === 0
                                }
                                className="inline-flex h-8 items-center justify-center rounded-xl px-3 text-sm font-medium bg-neutral-900 text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
                            >
                                Send
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

/* ---------- Settings integration ---------- */
function useShowTimestamps() {
    const [flag, setFlag] = useState<boolean>(() => {
        if (typeof window !== "undefined" && (window as any).__YS_SETTINGS) {
            return !!(window as any).__YS_SETTINGS.showTimestamps;
        }
        // Fallback to default until we know better
        return true;
    });

    useEffect(() => {
        const onSettings = (ev: Event) => {
            if (!(ev instanceof CustomEvent)) return;
            const detail: any = ev.detail || {};
            if (typeof detail.showTimestamps === "boolean") {
                setFlag(detail.showTimestamps);
            }
        };

        window.addEventListener("ysong:settings", onSettings);
        return () => {
            window.removeEventListener("ysong:settings", onSettings);
        };
    }, []);

    return flag;
}

/* ---------- Helpers ---------- */

function formatTime(input: number) {
    const d = new Date(input);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
