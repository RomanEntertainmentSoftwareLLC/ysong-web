import { useEffect, useRef, useState } from "react";
import { apiGet, clearToken } from "../lib/authApi";
import { getSaveChatsFlag } from "../lib/settings";
import UISidebar, { type Chat } from "../components/UISidebar";

/* ---------- tiny hook: true when viewport >= 1024px (Tailwind lg) ---------- */
function useMediaQuery(query: string) {
    const getMatch = () =>
        typeof window !== "undefined"
            ? window.matchMedia(query).matches
            : false;
    const [matches, setMatches] = useState<boolean>(getMatch);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const m = window.matchMedia(query);
        const onChange = () => setMatches(m.matches);
        // modern browsers
        m.addEventListener?.("change", onChange);
        // older Safari
        m.addListener?.(onChange);
        return () => {
            m.removeEventListener?.("change", onChange);
            m.removeListener?.(onChange);
        };
    }, [query]);

    return matches;
}
/* ------------------------------------------------------------------------- */

type ChatMessage = {
    role: "user" | "assistant";
    text: string;
    attachments?: { name: string; size: number; type: string }[];
    token?: string;
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

    // autoscroll
    const scrollerRef = useRef<HTMLDivElement | null>(null);
    const bottomRef = useRef<HTMLDivElement | null>(null);

    // responsive: mount/dismount mobile UI decisively
    const isLgUp = useMediaQuery("(min-width: 1024px)");

    // mobile drawer
    const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

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

    // Fetch minimal profile (email)
    useEffect(() => {
        apiGet<{ ok: boolean; user: { id: string; email: string } }>("/auth/me")
            .then((u) => setMe({ email: u.user.email }))
            .catch(() => {});
    }, []);

    // Hydrate chats when "Save to cloud" is ON
    useEffect(() => {
        if (!getSaveChatsFlag()) return;
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

    // close drawer when a chat is selected (mobile only)
    useEffect(() => {
        if (!isLgUp && mobileSidebarOpen) setMobileSidebarOpen(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeId]);

    // close drawer on Escape (mobile only)
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setMobileSidebarOpen(false);
        };
        if (!isLgUp) window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [isLgUp]);

    function newChat() {
        const id = crypto.randomUUID();
        const chat: Chat = { id, title: "", messages: [] as any };
        setChats([chat, ...chats]);
        setActiveId(id);
        scrollToBottom(false);
    }

    // file picker
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

        const currentChatId = activeId;
        const baseMsgs = (
            (chats.find((c) => c.id === currentChatId)
                ?.messages as ChatMessage[]) || []
        ).map((m) => ({ role: m.role, content: m.text }));

        // optimistic user message
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
                          messages: [
                              ...c.messages,
                              { role: "user", text, attachments },
                          ],
                      }
                    : c
            )
        );
        scrollToBottom(false);

        // typing bubble
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
        try {
            clearToken();
        } finally {
            window.location.replace("/login");
        }
    }

    // A11y: reflect expanded state on the hamburger when it exists
    const menuBtnRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        const el = menuBtnRef.current;
        if (!el) return;
        el.setAttribute("aria-expanded", mobileSidebarOpen ? "true" : "false");
    }, [mobileSidebarOpen]);

    return (
        <div className="fixed inset-x-0 top-[4rem] bottom-0 flex">
            {/* Desktop sidebar — ONLY renders when >= lg */}
            {isLgUp && (
                <div className="shrink-0 w-[280px] border-r border-neutral-200 dark:border-neutral-800">
                    <UISidebar
                        chats={chats as any}
                        activeId={activeId}
                        setActiveId={setActiveId}
                        newChat={newChat}
                        meEmail={me?.email}
                        onLogout={logout}
                    />
                </div>
            )}

            {/* Mobile hamburger + drawer — ONLY render when < lg */}
            {!isLgUp && (
                <>
                    {/* Hamburger */}
                    <button
                        ref={menuBtnRef}
                        type="button"
                        aria-controls="mobile-sidebar"
                        aria-haspopup="dialog"
                        aria-label={
                            mobileSidebarOpen ? "Close sidebar" : "Open sidebar"
                        }
                        onClick={() => setMobileSidebarOpen((v) => !v)}
                        className="
							lg:hidden fixed top-[4rem]
							right-[max(0.75rem,env(safe-area-inset-right))]
							z-[70] inline-flex h-10 w-10 items-center justify-center
							rounded-xl border bg-black/25 dark:bg-white/10 backdrop-blur
						"
                    >
                        {/* hamburger */}
                        <svg
                            viewBox="0 0 24 24"
                            className={`${
                                mobileSidebarOpen ? "hidden" : "block"
                            } h-6 w-6`}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2}
                            strokeLinecap="round"
                            aria-hidden="true"
                        >
                            <path d="M4 6h16M4 12h16M4 18h16" />
                        </svg>

                        {/* close (X) */}
                        <svg
                            viewBox="0 0 24 24"
                            className={`${
                                mobileSidebarOpen ? "block" : "hidden"
                            } h-6 w-6`}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2}
                            strokeLinecap="round"
                            aria-hidden="true"
                        >
                            <path d="M6 6l12 12M6 18L18 6" />
                        </svg>
                    </button>

                    {/* MOBILE: slide-in drawer */}
                    <div
                        className={`lg:hidden fixed inset-0 z-40 ${
                            mobileSidebarOpen ? "" : "pointer-events-none"
                        }`}
                    >
                        {/* overlay */}
                        <div
                            aria-hidden="true"
                            className={`absolute inset-0 bg-black/40 transition-opacity duration-200 ${
                                mobileSidebarOpen ? "opacity-100" : "opacity-0"
                            }`}
                            onClick={() => setMobileSidebarOpen(false)}
                        />
                        {/* panel */}
                        <div
                            id="mobile-sidebar"
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="mobile-sidebar-title"
                            className={`absolute inset-y-0 left-0 w-[85%] max-w-[360px] bg-white dark:bg-neutral-950 shadow-xl
										transition-transform duration-300 ${
                                            mobileSidebarOpen
                                                ? "translate-x-0"
                                                : "-translate-x-full"
                                        }`}
                        >
                            <div className="relative h-full">
                                <h2
                                    id="mobile-sidebar-title"
                                    className="sr-only"
                                >
                                    Sidebar
                                </h2>

                                {/* Close button inside the drawer */}
                                <button
                                    type="button"
                                    aria-label="Close sidebar"
                                    className="absolute right-3 top-3 h-9 w-9 inline-flex items-center justify-center rounded-lg border"
                                    onClick={() => setMobileSidebarOpen(false)}
                                >
                                    <svg
                                        viewBox="0 0 24 24"
                                        className="h-5 w-5"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth={2}
                                        strokeLinecap="round"
                                        aria-hidden="true"
                                    >
                                        <path d="M6 6l12 12M6 18L18 6" />
                                    </svg>
                                </button>

                                {/* Sidebar content */}
                                <div className="h-full overflow-y-auto">
                                    <UISidebar
                                        chats={chats as any}
                                        activeId={activeId}
                                        setActiveId={setActiveId}
                                        newChat={newChat}
                                        meEmail={me?.email}
                                        onLogout={logout}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </>
            )}

            {/* Main chat column */}
            <main className="flex-1 min-w-0 h-full min-h-0 flex flex-col">
                {/* Messages list */}
                <div
                    className="flex-1 min-h-0 overflow-y-auto"
                    style={{ scrollbarGutter: "stable both-edges" } as any}
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
                                    </div>
                                )
                            )}

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
                    {/* pending attachments */}
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
                            <label htmlFor="filePicker" className="sr-only">
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
                                id="filePicker"
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
            </main>
        </div>
    );
}
