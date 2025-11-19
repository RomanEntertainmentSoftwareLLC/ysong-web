import { useEffect, useRef, useState } from "react";
import type { TabRecord } from "./core";
import type { Chat } from "../components/UISidebar";
import { fetchChatMessages, appendMessage } from "../lib/chatApi";

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
    // messages can be missing when we only have the chat shell from /api/chats
    const messageCount = chat?.messages?.length ?? 0;

    const [input, setInput] = useState("");

    const [pendingFiles, setPendingFiles] = useState<File[]>([]);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const scrollerRef = useRef<HTMLDivElement | null>(null);
    const bottomRef = useRef<HTMLDivElement | null>(null);

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
                // 👇 NEW: ignore "chat_not_found" for empty/new chats
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
                    messages: baseMsgs.concat([
                        { role: "user", content: text },
                    ]),
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
                                                {formatTime(m.ts ?? Date.now())}
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
                            name="files"
                            ref={fileInputRef}
                            type="file"
                            multiple
                            onChange={onPickFiles}
                            accept="audio/*,image/*,.txt,.md,.lrc,.lyr,.rtf,.json"
                            className="hidden"
                        />

                        <input
                            id={`chat-input-${chatId}`}
                            name="message"
                            autoComplete="off"
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
