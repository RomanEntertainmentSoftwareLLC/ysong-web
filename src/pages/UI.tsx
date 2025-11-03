import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet, apiPost, clearToken } from "../lib/authApi";

type Chat = {
    id: string;
    title: string;
    messages: { role: "user" | "assistant"; text: string }[];
};

export default function UI() {
    const [me, setMe] = useState<{ email: string } | null>(null);
    const [chats, setChats] = useState<Chat[]>([
        {
            id: "1",
            title: "Welcome",
            messages: [{ role: "assistant", text: "Hey! Ask me anything 🎶" }],
        },
    ]);
    const [activeId, setActiveId] = useState("1");
    const [input, setInput] = useState("");
    const nav = useNavigate();

    useEffect(() => {
        apiGet<{ ok: boolean; user: { id: string; email: string } }>("/auth/me")
            .then((u) => setMe({ email: u.user.email }))
            .catch(() => {});
    }, []);

    const active = chats.find((c) => c.id === activeId)!;

    function newChat() {
        const id = crypto.randomUUID();
        const chat: Chat = { id, title: "New chat", messages: [] };
        setChats([chat, ...chats]);
        setActiveId(id);
    }

    async function send() {
        if (!input.trim()) return;
        const text = input.trim();
        setInput("");

        const currentChatId = activeId;
        const baseMsgs = (
            chats.find((c) => c.id === currentChatId)?.messages || []
        ).map((m) => ({ role: m.role, content: m.text }));

        // show user message immediately
        setChats((prev) =>
            prev.map((c) =>
                c.id === currentChatId
                    ? {
                          ...c,
                          messages: [...c.messages, { role: "user", text }],
                      }
                    : c
            )
        );

        // optimistic "typing…" bubble
        const typingToken = `__typing_${crypto.randomUUID()}__`;
        setChats((prev) =>
            prev.map((c) =>
                c.id === currentChatId
                    ? {
                          ...c,
                          messages: [
                              ...c.messages,
                              {
                                  role: "assistant",
                                  text: "…" as any,
                                  token: typingToken as any,
                              },
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

            // replace the last "typing…" with the real reply
            setChats((prev) =>
                prev.map((c) =>
                    c.id === currentChatId
                        ? {
                              ...c,
                              messages: c.messages.map((m, i, arr) =>
                                  i === arr.length - 1 &&
                                  (m as any).token === typingToken
                                      ? { role: "assistant", text: reply }
                                      : m
                              ),
                          }
                        : c
                )
            );
        } catch {
            setChats((prev) =>
                prev.map((c) =>
                    c.id === currentChatId
                        ? {
                              ...c,
                              messages: c.messages.map((m, i, arr) =>
                                  i === arr.length - 1 &&
                                  (m as any).token === typingToken
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
            await apiPost("/auth/logout", {});
        } catch {}
        clearToken();
        nav("/login");
    }

    return (
        // Two columns: fixed 20rem sidebar + fluid main
        <div className="grid [grid-template-columns:20rem_1fr] h-[calc(100vh-4rem)]">
            {/* Sidebar (fixed width, its own scroll if long) */}
            <aside className="border-r border-neutral-200 dark:border-neutral-800">
                <div className="h-full overflow-y-auto p-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <h2 className="font-semibold">Chats</h2>
                        <button
                            className="text-sm px-2 py-1 rounded-lg border"
                            onClick={newChat}
                        >
                            New
                        </button>
                    </div>

                    <div className="space-y-1">
                        {chats.map((c) => (
                            <button
                                key={c.id}
                                onClick={() => setActiveId(c.id)}
                                className={`w-full text-left px-3 py-2 rounded-lg border ${
                                    c.id === activeId
                                        ? "bg-neutral-100 dark:bg-neutral-900"
                                        : "hover:bg-neutral-50 dark:hover:bg-neutral-900"
                                }`}
                            >
                                <div className="truncate">{c.title}</div>
                                <div className="text-xs opacity-70 truncate">
                                    {c.messages[c.messages.length - 1]?.text ||
                                        "No messages yet"}
                                </div>
                            </button>
                        ))}
                    </div>

                    <div className="mt-6 text-xs opacity-80">
                        <div className="truncate">Signed in as</div>
                        <div className="truncate font-medium">
                            {me?.email || "…"}
                        </div>
                        <button
                            onClick={logout}
                            className="mt-2 text-rose-600 hover:underline"
                        >
                            Sign out
                        </button>
                    </div>
                </div>
            </aside>

            {/* Chat column */}
            <main className="flex flex-col h-[calc(100vh-4rem)]">
                {/* Message rail: fixed max width to prevent reflow; only this scrolls.
            overflow-y-scroll reserves scrollbar gutter = no horizontal shift */}
                <div className="flex-1 overflow-y-scroll">
                    <div className="mx-auto max-w-3xl w-full p-6 space-y-4">
                        {active.messages.map((m, i) => (
                            <div
                                key={i}
                                className={`flex ${
                                    m.role === "user"
                                        ? "justify-end"
                                        : "justify-start"
                                }`}
                            >
                                <div
                                    className={`w-full rounded-2xl px-4 py-3 ${
                                        m.role === "user"
                                            ? "bg-neutral-700 text-white dark:bg-neutral-800"
                                            : "bg-neutral-100 dark:bg-neutral-900"
                                    }`}
                                >
                                    {m.text}
                                </div>
                            </div>
                        ))}
                        {active.messages.length === 0 && (
                            <div className="opacity-70 text-sm">
                                Start a conversation below…
                            </div>
                        )}
                    </div>
                </div>

                {/* Input rail matches message rail width; single-line, no inner scroll */}
                <div className="border-t border-neutral-200 dark:border-neutral-800">
                    <div className="mx-auto max-w-3xl w-full p-4">
                        <div className="flex gap-2">
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
