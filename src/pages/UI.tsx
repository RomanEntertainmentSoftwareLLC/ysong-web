import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet, apiPost, clearToken } from "../lib/authApi";
import { getSaveChatsFlag } from "../lib/settings"; // ← NEW
import UISidebar, { type Chat } from "../components/UISidebar";

type ChatMessage = {
    role: "user" | "assistant";
    text: string;
    attachments?: { name: string; size: number; type: string }[]; // local-only metadata
    token?: string; // typing placeholder token
};

export default function UI() {
    const [me, setMe] = useState<{ email: string } | null>(null);

    const [chats, setChats] = useState<Chat[]>([
        {
            id: "1",
            title: "",
            messages: [
                {
                    role: "assistant",
                    text:
                        "Welcome to " +
                        import.meta.env.VITE_APP_NAME +
                        "! Ask me anything music related.",
                },
            ] as ChatMessage[],
        } as Chat,
    ]);
    const [activeId, setActiveId] = useState("1");

    const [input, setInput] = useState("");
    const [pendingFiles, setPendingFiles] = useState<File[]>([]);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    // --- autoscroll refs ---
    const scrollerRef = useRef<HTMLDivElement | null>(null);
    const bottomRef = useRef<HTMLDivElement | null>(null);

    function scrollToBottom(smooth = true) {
        const el = scrollerRef.current;
        if (el) {
            el.scrollTo({
                top: el.scrollHeight,
                behavior: smooth ? "smooth" : "auto",
            });
        } else {
            requestAnimationFrame(() => {
                bottomRef.current?.scrollIntoView({
                    behavior: smooth ? "smooth" : "auto",
                    block: "end",
                });
            });
        }
    }

    const nav = useNavigate();

    // Fetch minimal profile (email)
    useEffect(() => {
        apiGet<{ ok: boolean; user: { id: string; email: string } }>("/auth/me")
            .then((u) => setMe({ email: u.user.email }))
            .catch(() => {});
    }, []);

    // 🔒 Hydrate chats from server ONLY if "Save to cloud" is ON
    useEffect(() => {
        if (!getSaveChatsFlag()) return; // flag OFF ➜ stay local-only
        apiGet<{ chats: Chat[] }>("/api/chats")
            .then((data) => {
                if (!data?.chats || !Array.isArray(data.chats)) return;
                setChats(data.chats);
                if (data.chats.length) setActiveId(data.chats[0].id);
            })
            .catch(() => {});
    }, []);

    const active = chats.find((c) => c.id === activeId)!;

    // follow new messages
    useEffect(() => {
        scrollToBottom(true);
    }, [activeId, active.messages.length]);

    function newChat() {
        // Local-only creation for now; when you flip saving ON, we’ll add POST /api/chats
        const id = crypto.randomUUID();
        const chat: Chat = { id, title: "", messages: [] as any };
        setChats([chat, ...chats]);
        setActiveId(id);
        scrollToBottom(false);
    }

    // ---------- [+] picker handlers ----------
    function triggerPicker() {
        fileInputRef.current?.click();
    }

    function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
        const files = Array.from(e.target.files ?? []);
        if (!files.length) return;
        const filtered = files.filter((f) => f.size <= 50 * 1024 * 1024); // 50MB UI guard
        setPendingFiles((prev) => [...prev, ...filtered]);
        e.currentTarget.value = ""; // allow re-picking same files later
    }

    function removeAttachment(i: number) {
        setPendingFiles((prev) => prev.filter((_, idx) => idx !== i));
    }
    // ----------------------------------------

    async function send() {
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

        // snapshot
        const currentChatId = activeId;
        const baseMsgs = (
            (chats.find((c) => c.id === currentChatId)
                ?.messages as ChatMessage[]) || []
        ).map((m) => ({ role: m.role, content: m.text }));

        // show user msg immediately
        setChats((prev) =>
            prev.map((c) =>
                c.id === currentChatId
                    ? {
                          ...c,
                          title:
                              c.title && c.title.trim().length
                                  ? c.title
                                  : text
                                  ? text.length > 48
                                      ? text.slice(0, 47) + "…"
                                      : text
                                  : "New chat",
                          messages: [...c.messages, { role: "user", text }],
                      }
                    : c
            )
        );
        scrollToBottom(false);

        // optimistic typing bubble
        const typingToken = `__typing_${crypto.randomUUID()}__`;
        setChats((prev) =>
            prev.map((c) =>
                c.id === currentChatId
                    ? {
                          ...c,
                          messages: [
                              ...(c.messages as any),
                              {
                                  role: "assistant",
                                  text: "…",
                                  token: typingToken,
                              } as ChatMessage,
                          ],
                      }
                    : c
            )
        );

        try {
            const res = await fetch("https://api.ysong.ai/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    messages: [...baseMsgs, { role: "user", content: text }],
                }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const reply = data?.reply ?? "…";

            setChats((prev) =>
                prev.map((c) =>
                    c.id === currentChatId
                        ? {
                              ...c,
                              messages: (c.messages as any).map(
                                  (
                                      m: ChatMessage,
                                      i: number,
                                      arr: ChatMessage[]
                                  ) =>
                                      i === arr.length - 1 &&
                                      m.token === typingToken
                                          ? { role: "assistant", text: reply }
                                          : m
                              ),
                          }
                        : c
                )
            );
            scrollToBottom(true);
        } catch {
            setChats((prev) =>
                prev.map((c) =>
                    c.id === currentChatId
                        ? {
                              ...c,
                              messages: (c.messages as any).map(
                                  (
                                      m: ChatMessage,
                                      i: number,
                                      arr: ChatMessage[]
                                  ) =>
                                      i === arr.length - 1 &&
                                      m.token === typingToken
                                          ? {
                                                role: "assistant",
                                                text: "⚠️ AI request failed.",
                                            }
                                          : m
                              ),
                          }
                        : c
                )
            );
        }
    }

    async function logout() {
        // No server call needed — we’re token-based
        try {
            clearToken();
        } finally {
            window.location.replace("/login");
        }
    }

    return (
        <div className="fixed inset-x-0 top-[4rem] bottom-0 flex">
            {/* Sidebar */}
            <UISidebar
                chats={chats as any}
                activeId={activeId}
                setActiveId={setActiveId}
                newChat={newChat}
                meEmail={me?.email}
                onLogout={logout}
            />

            {/* Main chat column */}
            <main className="flex-1 h-full min-h-0 flex flex-col">
                {/* Messages list */}
                <div
                    className="flex-1 min-h-0 overflow-y-auto"
                    style={{ scrollbarGutter: "stable both-edges" as any }}
                    ref={scrollerRef}
                >
                    {/* centered chat rail */}
                    <div className="mx-auto w-full max-w-[720px] px-4 sm:px-6 pt-6 pb-4">
                        <div className="flex flex-col gap-4">
                            {(active.messages as unknown as ChatMessage[]).map(
                                (m, i) => (
                                    <div
                                        key={i}
                                        className={`flex ${
                                            m.role === "user"
                                                ? "justify-end"
                                                : "justify-start"
                                        }`}
                                    >
                                        <div
                                            className={`rounded-2xl px-4 py-3 leading-relaxed shadow-sm
                      ${
                          m.role === "user"
                              ? "bg-neutral-700 text-white dark:bg-neutral-800"
                              : "bg-neutral-100 dark:bg-neutral-900"
                      }
                      max-w-[70%]`}
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
                                    </div>
                                )
                            )}

                            {/* anchor for autoscroll */}
                            <div ref={bottomRef} />

                            {(active.messages as any).length === 0 && (
                                <div className="opacity-70 text-sm">
                                    Start a conversation below…
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Composer */}
                <div className="border-t border-neutral-200 dark:border-neutral-800">
                    {/* chips for pending attachments */}
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

                    <div className="mx-auto w-full max-w-[720px] px-4 sm:px-6 py-4">
                        <div className="flex items-center gap-2">
                            {/* Visually hidden label for the file input */}
                            <label htmlFor="filePicker" className="sr-only">
                                Add files
                            </label>

                            {/* [+] button that triggers the hidden input */}
                            <button
                                type="button"
                                onClick={triggerPicker}
                                className="shrink-0 px-3 py-2 rounded-lg border"
                                title="Add files"
                                aria-label="Add files"
                            >
                                +
                            </button>

                            {/* Hidden file input with an id that matches the label */}
                            <input
                                id="filePicker"
                                ref={fileInputRef}
                                type="file"
                                multiple
                                onChange={onPickFiles}
                                accept="audio/*,image/*,.txt,.md,.lrc,.lyr,.rtf,.json"
                                className="hidden"
                            />

                            {/* Text box */}
                            <input
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && send()}
                                placeholder={`Message ${
                                    import.meta.env.VITE_APP_NAME
                                }…`}
                                className="flex-1 rounded-lg border border-neutral-300 dark:border-neutral-700
									bg-white dark:bg-neutral-900 px-3 py-2 focus:outline-none
									focus:ring-2 focus:ring-neutral-500/40"
                            />

                            <button
                                onClick={send}
                                className="px-4 py-2 rounded-lg border"
                            >
                                Send
                            </button>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
