// src/pages/UI.tsx
import {
    useEffect,
    useRef,
    useState,
    type Dispatch,
    type SetStateAction,
} from "react";
import { apiGet, clearToken } from "../lib/authApi";
import { getSaveChatsFlag } from "../lib/settings";
import UISidebar, { type Chat } from "../components/UISidebar";
import {
    TabManagerProvider,
    TabBar,
    TabContentHost,
    useTabManager,
    type TabType,
    type TabRendererProps,
} from "../tabs/core";
import ChatPane from "../tabs/ChatPane";
import SettingsPane from "../tabs/SettingsPane";

const WELCOME = `Welcome to ${
    import.meta.env.VITE_APP_NAME
}! Ask me anything music related.`;

/* ---------- tiny hook: >= 1024px (Tailwind lg) ---------- */
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
        m.addEventListener?.("change", onChange);
        m.addListener?.(onChange); // older Safari
        return () => {
            m.removeEventListener?.("change", onChange);
            m.removeListener?.(onChange);
        };
    }, [query]);

    return matches;
}

/* Make sure we have at least one chat; return its id. */
function useEnsureWelcomeChat(setChats: Dispatch<SetStateAction<Chat[]>>) {
    return () => {
        const id = crypto.randomUUID();
        setChats((current) => {
            if (current.length > 0) return current;
            const seed: Chat = {
                id,
                title: "",
                messages: [{ role: "assistant", text: WELCOME }],
            };
            return [seed].concat(current);
        });
        return id;
    };
}

/* Opens a chat tab on first load if none are open */
function BootTabs({
    chats,
    ensureChat,
}: {
    chats: Chat[];
    ensureChat: () => string;
}) {
    const { tabs, openTab } = useTabManager();
    const didBoot = useRef(false);

    useEffect(() => {
        if (didBoot.current) return;
        didBoot.current = true;

        const chatId = chats[0]?.id ?? ensureChat(); // create only on first mount
        openTab({ type: "chat", title: "New Chat", payload: { chatId } });
    }, []); // <- empty deps; ref prevents StrictMode double-run

    return null;
}

export default function UI() {
    const [me, setMe] = useState<{ email: string } | null>(null);

    const [chats, setChats] = useState<Chat[]>([
        {
            id: "1",
            title: "",
            messages: [{ role: "assistant", text: WELCOME }] as any[],
        },
    ]);
    const [activeId, setActiveId] = useState("1");

    // responsive + mobile drawer
    const isLgUp = useMediaQuery("(min-width: 1024px)");
    const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
    const ensureWelcomeChat = useEnsureWelcomeChat(setChats);

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

    // --- mobile drawer UX ---
    useEffect(() => {
        if (!isLgUp && mobileSidebarOpen) setMobileSidebarOpen(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeId]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) =>
            e.key === "Escape" && setMobileSidebarOpen(false);
        if (!isLgUp) window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [isLgUp]);

    useEffect(() => {
        const html = document.documentElement;
        const body = document.body;
        const prevHtml = html.style.overflow;
        const prevBody = body.style.overflow;
        if (mobileSidebarOpen) {
            html.style.overflow = "hidden";
            body.style.overflow = "hidden";
        } else {
            html.style.overflow = prevHtml || "";
            body.style.overflow = prevBody || "";
        }
        return () => {
            html.style.overflow = prevHtml || "";
            body.style.overflow = prevBody || "";
        };
    }, [mobileSidebarOpen]);

    async function logout() {
        try {
            clearToken();
        } finally {
            window.location.replace("/login");
        }
    }

    /* ----------------------------- Tab registry ----------------------------- */
    const registry = {
        chat: ({ tab }: TabRendererProps) => (
            <ChatPane tab={tab} chats={chats} setChats={setChats} />
        ),
        settings: ({ tab }: TabRendererProps) => <SettingsPane tab={tab} />,
        daw: () => <Stub title="DAW" />,
        mixer: () => <Stub title="Mixer" />,
        market: () => <Stub title="Marketplace" />,
        band: () => <Stub title="Band Creation" />,
        artwork: () => <Stub title="Artwork Editor" />,
        world: () => <Stub title="YSong World" />,
    } as const;

    /* Bridge so UISidebar buttons open/activate tabs */
    function SidebarWithTabsBridge(p: {
        meEmail?: string | null;
        chats: Chat[];
        activeId: string;
        setActiveId: (id: string) => void;
        setChats: Dispatch<SetStateAction<Chat[]>>;
        onLogout: () => void;
    }) {
        const { tabs, openTab, activateTab, updateTab, closeTab } =
            useTabManager();

        const smartTitle = (c: Chat) => {
            const fromTitle = (c.title ?? "").trim();
            if (fromTitle) return fromTitle.slice(0, 48);
            const fromUser =
                c.messages.find((m: any) => m.role === "user")?.text ?? "";
            return (fromUser || "New Chat").slice(0, 48);
        };

        const onOpenChatTab = (c: Chat) => {
            const existing = tabs.find(
                (t) => t.type === "chat" && t.payload?.chatId === c.id
            );
            if (existing) return activateTab(existing.id);
            openTab({
                type: "chat",
                title: smartTitle(c),
                payload: { chatId: c.id },
            });
        };

        const onOpenModule = (type: Exclude<TabType, "chat"> | "chat") => {
            if (type === "chat") {
                const id = crypto.randomUUID();
                const newChat: Chat = {
                    id,
                    title: "",
                    messages: [{ role: "assistant", text: WELCOME }] as any[],
                };
                p.setChats((current) => [newChat, ...current]);
                openTab({
                    type: "chat",
                    title: "New Chat",
                    payload: { chatId: id },
                });
                return;
            }
            const titles = {
                settings: "Settings",
                daw: "DAW",
                mixer: "Mixer",
                market: "Marketplace",
                band: "Band Creation",
                artwork: "Artwork Editor",
                world: "YSong World",
            } as const;
            const existing = tabs.find((t) => t.type === type);
            if (existing) return activateTab(existing.id);
            openTab({ type, title: titles[type], pinned: true });
        };

        const handleRenameChat = (chatId: string, newTitle: string) => {
            p.setChats((prev) =>
                prev.map((c) =>
                    c.id === chatId ? { ...c, title: newTitle } : c
                )
            );
            tabs.forEach((t) => {
                if (t.type === "chat" && t.payload?.chatId === chatId) {
                    updateTab(t.id, { title: newTitle });
                }
            });
        };

        const handleDeleteChat = (chatId: string) => {
            p.setChats((prev) => prev.filter((c) => c.id !== chatId));
            if (p.activeId === chatId) {
                const next = p.chats.find((c) => c.id !== chatId);
                p.setActiveId(next ? next.id : "");
            }
            tabs.filter(
                (t) => t.type === "chat" && t.payload?.chatId === chatId
            ).forEach((t) => closeTab(t.id));
        };

        return (
            <UISidebar
                chats={p.chats as any}
                activeId={p.activeId}
                setActiveId={p.setActiveId}
                newChat={() => onOpenModule("chat")}
                meEmail={p.meEmail}
                onLogout={p.onLogout}
                onOpenChatTab={onOpenChatTab}
                onOpenModule={onOpenModule as any}
                onRenameChat={handleRenameChat}
                onDeleteChat={handleDeleteChat}
            />
        );
    }

    return (
        <TabManagerProvider>
            <div className="fixed inset-x-0 top-[4rem] bottom-0 flex">
                {/* Desktop sidebar */}
                {isLgUp && (
                    <div className="shrink-0 w-[280px] border-r border-neutral-200 dark:border-neutral-800">
                        <SidebarWithTabsBridge
                            meEmail={me?.email}
                            chats={chats}
                            activeId={activeId}
                            setActiveId={setActiveId}
                            setChats={setChats}
                            onLogout={logout}
                        />
                    </div>
                )}

                {/* Mobile hamburger + drawer */}
                {!isLgUp && (
                    <>
                        <MobileHamburger
                            open={mobileSidebarOpen}
                            setOpen={setMobileSidebarOpen}
                        />
                        <MobileDrawer
                            open={mobileSidebarOpen}
                            onClose={() => setMobileSidebarOpen(false)}
                        >
                            <SidebarWithTabsBridge
                                meEmail={me?.email}
                                chats={chats}
                                activeId={activeId}
                                setActiveId={setActiveId}
                                setChats={setChats}
                                onLogout={logout}
                            />
                        </MobileDrawer>
                    </>
                )}

                {/* Main: Tab bar + active tab */}
                <main className="flex-1 min-w-0 h-full min-h-0 flex flex-col">
                    <TabBar />
                    <TabContentHost registry={registry} />
                </main>
            </div>

            {/* auto-open first Chat tab */}
            <BootTabs chats={chats} ensureChat={ensureWelcomeChat} />
        </TabManagerProvider>
    );
}

/* ------------------- tiny mobile helpers (unchanged look) ------------------ */

function MobileHamburger({
    open,
    setOpen,
}: {
    open: boolean;
    setOpen: (v: boolean) => void;
}) {
    const menuBtnRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        const el = menuBtnRef.current;
        if (!el) return;
        el.setAttribute("aria-expanded", open ? "true" : "false");
    }, [open]);

    const wasOpenRef = useRef(false);
    useEffect(() => {
        if (wasOpenRef.current && !open) {
            menuBtnRef.current?.focus();
        }
        wasOpenRef.current = open;
    }, [open]);

    return (
        <button
            ref={menuBtnRef}
            type="button"
            aria-controls="mobile-sidebar"
            aria-haspopup="dialog"
            aria-label={open ? "Close sidebar" : "Open sidebar"}
            onClick={() => setOpen(!open)}
            className="lg:hidden fixed top-[4rem] right-[max(0.75rem,env(safe-area-inset-right))] z-[70] inline-flex h-10 w-10 items-center justify-center rounded-xl border bg-black/25 dark:bg-white/10 backdrop-blur"
        >
            {/* hamburger */}
            <svg
                viewBox="0 0 24 24"
                className={`${open ? "hidden" : "block"} h-6 w-6`}
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
                className={`${open ? "block" : "hidden"} h-6 w-6`}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                aria-hidden="true"
            >
                <path d="M6 6l12 12M6 18L18 6" />
            </svg>
        </button>
    );
}

function MobileDrawer({
    open,
    onClose,
    children,
}: {
    open: boolean;
    onClose: () => void;
    children: React.ReactNode;
}) {
    return (
        <div
            className={`lg:hidden fixed left-0 right-0 top-[4rem] bottom-0 z-40 ${
                open ? "" : "pointer-events-none"
            }`}
        >
            <div
                aria-hidden="true"
                className={`absolute inset-0 bg-black/40 transition-opacity duration-200 ${
                    open ? "opacity-100" : "opacity-0"
                }`}
                onClick={onClose}
            />
            <div
                id="mobile-sidebar"
                role="dialog"
                aria-modal="true"
                aria-labelledby="mobile-sidebar-title"
                className={`absolute inset-y-0 left-0 w-[85%] max-w-[360px] bg-white dark:bg-neutral-950 shadow-xl transition-transform duration-300 ${
                    open ? "translate-x-0" : "-translate-x-full"
                }`}
            >
                <div className="relative h-full">
                    <h2 id="mobile-sidebar-title" className="sr-only">
                        Sidebar
                    </h2>
                    <button
                        type="button"
                        aria-label="Close sidebar"
                        className="absolute right-3 top-3 h-9 w-9 inline-flex items-center justify-center rounded-lg border"
                        onClick={onClose}
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

                    <div className="h-full overflow-y-auto">{children}</div>
                </div>
            </div>
        </div>
    );
}

/* ------------------------------ simple stubs ------------------------------ */
function Stub({ title }: { title: string }) {
    return (
        <div className="h-full p-6 text-sm opacity-80">
            <div className="text-lg font-semibold mb-2">{title}</div>
            <div>Coming soon…</div>
        </div>
    );
}
