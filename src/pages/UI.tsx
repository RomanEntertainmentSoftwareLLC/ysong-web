// src/pages/UI.tsx
import {
    useEffect,
    useRef,
    useState,
    type Dispatch,
    type SetStateAction,
} from "react";
import { apiGet, apiPost, clearToken } from "../lib/authApi";
import { loadUserSettings } from "../lib/userPrefsApi";
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
    me,
    chats,
    ensureChat,
    chatsHydrated,
    onLayoutHydrated,
}: {
    me: { email: string } | null;
    chats: Chat[];
    ensureChat: () => string;
    chatsHydrated: boolean;
    onLayoutHydrated: () => void;
}) {
    const { tabs, openTab, activateTab } = useTabManager();
    const did = useRef(false);

    useEffect(() => {
        if (!chatsHydrated) return; // wait for settings + chats
        if (!me) return; // need user info
        if (did.current) return; // idempotent

        // If tabs already exist (edge case), just mark layout as ready.
        if (tabs.length > 0) {
            did.current = true;
            onLayoutHydrated();
            return;
        }

        did.current = true;

        (async () => {
            let restored = false;

            try {
                const data = await apiGet<{ tabs?: any[]; activeId?: string }>(
                    "/api/ui/layout"
                );

                if (data?.tabs && data.tabs.length > 0) {
                    // Only restore chat tabs whose chatId actually exists in Neon
                    const knownChatIds = new Set(chats.map((c) => c.id));

                    const filteredTabs = (data.tabs as any[]).filter((t) => {
                        if (t.type !== "chat") return true;
                        const chatId = t.payload?.chatId;
                        return chatId && knownChatIds.has(chatId);
                    });

                    if (filteredTabs.length > 0) {
                        filteredTabs.forEach((t) => openTab(t as any));

                        let activeId = data.activeId;
                        if (
                            !activeId ||
                            !filteredTabs.some((t) => t.id === activeId)
                        ) {
                            activeId = filteredTabs[0].id;
                        }
                        if (activeId) activateTab(activeId);
                        restored = true;
                    }
                }
            } catch (err) {
                console.warn("Failed to restore tab layout", err);
            }

            if (!restored) {
                // fall back to a welcome chat
                const firstChatId = chats[0]?.id;
                const chatId = firstChatId ?? ensureChat();
                openTab({
                    type: "chat",
                    title: "New Chat",
                    payload: { chatId },
                });
            }

            onLayoutHydrated();
        })();
    }, [
        chatsHydrated,
        me,
        tabs.length,
        chats,
        ensureChat,
        openTab,
        activateTab,
        onLayoutHydrated,
    ]);

    return null;
}

export default function UI() {
    const [me, setMe] = useState<{ email: string } | null>(null);

    const [chats, setChats] = useState<Chat[]>([]);
    const [chatsHydrated, setChatsHydrated] = useState(false);
    const [activeId, setActiveId] = useState("");
    const [layoutHydrated, setLayoutHydrated] = useState(false);

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

    // Hydrate chats when "Save to cloud" is ON (Neon-backed via /api/settings)
    useEffect(() => {
        let cancelled = false;

        (async () => {
            try {
                // 1) Ask server for settings (Neon)
                const settings = await loadUserSettings();
                if (cancelled) return;

                // If user has saveChats turned off on the server, we are done
                if (!settings?.saveChats) {
                    setChatsHydrated(true);
                    return;
                }

                // 2) If saveChats is true, pull chats from cloud
                const data = await apiGet<{ chats: Chat[] }>("/api/chats");
                if (cancelled) return;

                if (data?.chats && Array.isArray(data.chats)) {
                    setChats(data.chats);
                    if (data.chats.length > 0) {
                        setActiveId(data.chats[0].id);
                    }
                }
            } catch (err) {
                console.error("Failed to hydrate settings/chats", err);
            } finally {
                if (!cancelled) {
                    setChatsHydrated(true);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
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

    function PersistLayout({ ready }: { ready: boolean }) {
        const { tabs, activeId } = useTabManager();

        useEffect(() => {
            if (!ready) return; // don’t write until initial layout is known
            const t = setTimeout(() => {
                apiPost("/api/ui/layout", { tabs, activeId }).catch(() => {});
            }, 500);
            return () => clearTimeout(t);
        }, [ready, tabs, activeId]);

        return null;
    }

    async function logout() {
        try {
            clearToken();
            // Also clear any tab layout stored in this browser so we start clean
            try {
                localStorage.removeItem("ysong.tabs");
                localStorage.removeItem("ysong.activeTabId");
            } catch {
                // non-fatal; just log and move on
                console.warn("Failed to clear UI layout from localStorage");
            }
        } finally {
            window.location.replace("/login");
        }
    }

    /* ----------------------------- Tab registry ----------------------------- */
    const registry = {
        // IMPORTANT: use the actual components here so their identity is stable.
        chat: ChatPane,
        settings: SettingsPane,

        // These are lightweight stubs; leaving them as trivial components is fine.
        daw: (_props: TabRendererProps) => <Stub title="DAW" />,
        mixer: (_props: TabRendererProps) => <Stub title="Mixer" />,
        market: (_props: TabRendererProps) => <Stub title="Marketplace" />,
        band: (_props: TabRendererProps) => <Stub title="Band Creation" />,
        artwork: (_props: TabRendererProps) => <Stub title="Artwork Editor" />,
        world: (_props: TabRendererProps) => <Stub title="YSong World" />,
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

            const msgs = Array.isArray(c.messages) ? c.messages : [];
            const fromUser =
                msgs.find((m: any) => m.role === "user")?.text ?? "";
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
            // snapshot for optional rollback
            const previousChats = p.chats;

            // 🔹 Optimistic UI update
            p.setChats((prev) => prev.filter((c) => c.id !== chatId));

            if (p.activeId === chatId) {
                const next = previousChats.find((c) => c.id !== chatId);
                p.setActiveId(next ? next.id : "");
            }

            tabs.filter(
                (t) => t.type === "chat" && t.payload?.chatId === chatId
            ).forEach((t) => closeTab(t.id));

            // 🔹 Tell the server to delete from Neon
            apiPost("/api/chats/delete", { chatId }).catch((err) => {
                console.error("Failed to delete chat on server", err);
                // If you want strict consistency, uncomment this rollback:
                // p.setChats(previousChats);
            });
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
                {/* Note to Self, move this MobileDrawer inside the UINav bar. It is covering the tabs. */}
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
                    <TabContentHost
                        registry={registry}
                        extraProps={{ chats, setChats }}
                    />
                </main>
            </div>

            {/* auto-open first Chat tab */}
            <BootTabs
                me={me}
                chats={chats}
                ensureChat={ensureWelcomeChat}
                chatsHydrated={chatsHydrated}
                onLayoutHydrated={() => setLayoutHydrated(true)}
            />
            <PersistLayout ready={layoutHydrated} />
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
