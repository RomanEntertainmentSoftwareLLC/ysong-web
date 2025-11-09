import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";

/**************************************
 * YSong Tab System — Starter Implementation
 * - TabManagerProvider (context)
 * - Registry (type -> component)
 * - TabBar with pin/close/reorder (drag & drop)
 * - Overflow → "More" menu (simple)
 * - AppShell with mobile sidebar + menu items
 *
 * Drop this file anywhere (e.g. src/tabs/TabSystemDemo.tsx)
 * and render <YSongTabDemo /> to preview the behavior.
 **************************************/

/*****************
 * Types
 *****************/
export type TabId = string;
export type TabType =
    | "chat"
    | "settings"
    | "daw"
    | "mixer"
    | "market"
    | "band"
    | "artwork"
    | "world";

export type TabRecord = {
    id: TabId;
    type: TabType;
    title: string;
    pinned?: boolean;
    dirty?: boolean;
    payload?: unknown;
};

export type TabComponentProps<T = unknown> = {
    id: TabId;
    tab: TabRecord;
    payload?: T;
    onSetDirty?: (dirty: boolean) => void;
};

export type Registry = Record<
    TabType,
    React.ComponentType<TabComponentProps<any>>
>;

/*****************
 * Utilities
 *****************/
const uid = () =>
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const clamp = (n: number, min: number, max: number) =>
    Math.max(min, Math.min(max, n));

/*****************
 * Context
 *****************/

interface TabManagerContextValue {
    tabs: TabRecord[];
    activeId: TabId | null;
    registry: Registry;
    openTab: (t: Omit<TabRecord, "id"> & { id?: TabId }) => TabId;
    closeTab: (id: TabId) => void;
    activateTab: (id: TabId) => void;
    pinTab: (id: TabId, pinned: boolean) => void;
    reorderTabs: (from: number, to: number) => void;
    setTitle: (id: TabId, title: string) => void;
}

const TabManagerContext = createContext<TabManagerContextValue | null>(null);

export const useTabManager = () => {
    const ctx = useContext(TabManagerContext);
    if (!ctx)
        throw new Error(
            "useTabManager must be used inside <TabManagerProvider>"
        );
    return ctx;
};

/*****************
 * Provider
 *****************/

interface ProviderProps {
    children: React.ReactNode;
    registry: Registry;
    initialTabs?: TabRecord[];
    initialActiveId?: TabId | null;
    persistKey?: string; // optional localStorage persistence key
}

export const TabManagerProvider: React.FC<ProviderProps> = ({
    children,
    registry,
    initialTabs = [],
    initialActiveId = null,
    persistKey,
}) => {
    const [tabs, setTabs] = useState<TabRecord[]>(() => {
        if (persistKey) {
            try {
                const raw = localStorage.getItem(persistKey);
                if (raw) {
                    const parsed = JSON.parse(raw) as {
                        tabs: TabRecord[];
                        activeId: TabId | null;
                    };
                    return parsed.tabs || initialTabs;
                }
            } catch {}
        }
        return initialTabs;
    });

    const [activeId, setActiveId] = useState<TabId | null>(() => {
        if (persistKey) {
            try {
                const raw = localStorage.getItem(persistKey);
                if (raw) {
                    const parsed = JSON.parse(raw) as {
                        tabs: TabRecord[];
                        activeId: TabId | null;
                    };
                    return (
                        parsed.activeId ??
                        initialActiveId ??
                        initialTabs[0]?.id ??
                        null
                    );
                }
            } catch {}
        }
        return initialActiveId ?? initialTabs[0]?.id ?? null;
    });

    // persist minimal state
    useEffect(() => {
        if (!persistKey) return;
        try {
            localStorage.setItem(
                persistKey,
                JSON.stringify({ tabs, activeId })
            );
        } catch {}
    }, [tabs, activeId, persistKey]);

    const openTab = useCallback(
        (spec: Omit<TabRecord, "id"> & { id?: TabId }) => {
            const id = spec.id ?? uid();
            setTabs((prev) => {
                const next = [...prev, { id, ...spec }];
                return next;
            });
            setActiveId(id);
            return id;
        },
        []
    );

    const closeTab = useCallback(
        (id: TabId) => {
            setTabs((prev) => {
                const idx = prev.findIndex((t) => t.id === id);
                if (idx === -1) return prev;
                const next = prev.filter((t) => t.id !== id);
                // activate neighbor if closing active
                if (activeId === id) {
                    const neighbor = next[idx - 1]?.id ?? next[idx]?.id ?? null;
                    setActiveId(neighbor);
                }
                return next;
            });
        },
        [activeId]
    );

    const activateTab = useCallback((id: TabId) => setActiveId(id), []);

    const pinTab = useCallback((id: TabId, pinned: boolean) => {
        setTabs((prev) =>
            prev.map((t) => (t.id === id ? { ...t, pinned } : t))
        );
    }, []);

    const reorderTabs = useCallback((from: number, to: number) => {
        setTabs((prev) => {
            if (from === to) return prev;
            const next = [...prev];
            const [moved] = next.splice(from, 1);
            // keep pinned block on the left
            const pinnedCount =
                next.filter((t) => t.pinned).length + (moved.pinned ? 1 : 0);
            const minIndex = moved.pinned ? 0 : pinnedCount;
            const maxIndex = moved.pinned ? pinnedCount - 1 : next.length;
            const clampedTo = clamp(to, minIndex, maxIndex);
            next.splice(clampedTo, 0, moved);
            return next;
        });
    }, []);

    const setTitle = useCallback((id: TabId, title: string) => {
        setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, title } : t)));
    }, []);

    const value = useMemo(
        () => ({
            tabs,
            activeId,
            registry,
            openTab,
            closeTab,
            activateTab,
            pinTab,
            reorderTabs,
            setTitle,
        }),
        [
            tabs,
            activeId,
            registry,
            openTab,
            closeTab,
            activateTab,
            pinTab,
            reorderTabs,
            setTitle,
        ]
    );

    return (
        <TabManagerContext.Provider value={value}>
            {children}
        </TabManagerContext.Provider>
    );
};

/*****************
 * Hooks & helpers
 *****************/
const useIsMobile = () => {
    const [mobile, setMobile] = useState(false);
    useEffect(() => {
        const onResize = () => setMobile(window.innerWidth < 768);
        onResize();
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);
    return mobile;
};

/*****************
 * UI: Tab Bar
 *****************/

const TabBar: React.FC = () => {
    const { tabs, activeId, activateTab, closeTab, pinTab, reorderTabs } =
        useTabManager();
    const isMobile = useIsMobile();
    const maxVisible = isMobile ? 4 : 8; // simple overflow rule

    const pinned = tabs.filter((t) => t.pinned);
    const unpinned = tabs.filter((t) => !t.pinned);
    const ordered = [...pinned, ...unpinned];

    const visible = ordered.slice(0, maxVisible);
    const overflow = ordered.slice(maxVisible);

    const dragIndexRef = useRef<number | null>(null);

    const onDragStart = (index: number, e: React.DragEvent) => {
        dragIndexRef.current = index;
        e.dataTransfer.effectAllowed = "move";
    };
    const onDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
    };
    const onDrop = (index: number, e: React.DragEvent) => {
        e.preventDefault();
        const from = dragIndexRef.current;
        if (from == null) return;
        dragIndexRef.current = null;
        reorderTabs(from, index);
    };

    return (
        <div className="flex items-stretch gap-2 border-b border-white/10 px-2 bg-neutral-900/60 backdrop-blur">
            <div className="flex-1 min-w-0 flex items-stretch overflow-hidden">
                {visible.map((t, i) => {
                    const indexInAll = ordered.findIndex((x) => x.id === t.id);
                    const active = t.id === activeId;
                    return (
                        <div
                            key={t.id}
                            draggable
                            onDragStart={(e) => onDragStart(indexInAll, e)}
                            onDragOver={onDragOver}
                            onDrop={(e) => onDrop(indexInAll, e)}
                            className={`group flex items-center max-w-[16rem] min-w-[8rem] mr-1 select-none rounded-t-xl px-3 py-2 text-sm cursor-pointer border-b-2 transition-all ${
                                active
                                    ? "border-b-2 border-indigo-400 bg-neutral-800"
                                    : "border-transparent hover:bg-neutral-800/60"
                            }`}
                            onClick={() => activateTab(t.id)}
                            title={t.title}
                        >
                            <span className="truncate">{t.title}</span>
                            {t.dirty && (
                                <span className="ml-1 inline-block w-2 h-2 rounded-full bg-amber-400" />
                            )}
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    pinTab(t.id, !t.pinned);
                                }}
                                className="ml-2 text-xs opacity-60 hover:opacity-100"
                                title={t.pinned ? "Unpin" : "Pin"}
                            >
                                {t.pinned ? "📌" : "📍"}
                            </button>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    closeTab(t.id);
                                }}
                                className="ml-2 opacity-60 hover:opacity-100"
                                title="Close"
                            >
                                ✕
                            </button>
                        </div>
                    );
                })}
            </div>

            {overflow.length > 0 && <MoreMenu items={overflow} />}
        </div>
    );
};

const MoreMenu: React.FC<{ items: TabRecord[] }> = ({ items }) => {
    const { activateTab } = useTabManager();
    const [open, setOpen] = useState(false);
    const btnRef = useRef<HTMLButtonElement | null>(null);

    useEffect(() => {
        const onDoc = (e: MouseEvent) => {
            if (!btnRef.current) return;
            const el = e.target as Node;
            if (!btnRef.current.parentElement?.contains(el)) setOpen(false);
        };
        document.addEventListener("mousedown", onDoc);
        return () => document.removeEventListener("mousedown", onDoc);
    }, []);

    return (
        <div className="relative">
            <button
                ref={btnRef}
                onClick={() => setOpen((v) => !v)}
                className="px-3 py-2 rounded-md bg-neutral-800 hover:bg-neutral-700 border border-white/10 text-sm"
                title="More tabs"
            >
                •••
            </button>
            {open && (
                <div className="absolute right-0 mt-2 w-56 rounded-xl border border-white/10 bg-neutral-900 shadow-xl p-1 z-20">
                    {items.map((t) => (
                        <button
                            key={t.id}
                            onClick={() => {
                                activateTab(t.id);
                                setOpen(false);
                            }}
                            className="w-full text-left px-3 py-2 rounded-lg hover:bg-neutral-800 text-sm truncate"
                            title={t.title}
                        >
                            {t.pinned ? "📌 " : ""}
                            {t.title}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

/*****************
 * UI: Content Host
 *****************/

const TabContentHost: React.FC = () => {
    const { tabs, activeId, registry } = useTabManager();
    const active = tabs.find((t) => t.id === activeId) ?? null;
    if (!active)
        return (
            <div className="p-6 text-sm text-neutral-400">No tab selected.</div>
        );

    const Comp = registry[active.type];
    return (
        <div className="flex-1 overflow-auto">
            <Comp id={active.id} tab={active} payload={active.payload} />
        </div>
    );
};

/*****************
 * Sidebar (mobile-aware) — menu opens tabs
 *****************/

const SidebarMenu: React.FC<{
    onOpen: (type: TabType) => void;
    onClose?: () => void;
}> = ({ onOpen, onClose }) => {
    const items: { label: string; type: TabType }[] = [
        { label: "Chat", type: "chat" },
        { label: "Settings", type: "settings" },
        { label: "DAW", type: "daw" },
        { label: "Mixer", type: "mixer" },
        { label: "Marketplace", type: "market" },
        { label: "Band Creation", type: "band" },
        { label: "Artwork Editor", type: "artwork" },
        { label: "YSong World", type: "world" },
    ];

    return (
        <nav className="flex flex-col gap-1 p-2 max-h-screen overflow-y-auto">
            {items.map((it) => (
                <button
                    key={it.type}
                    onClick={() => {
                        onOpen(it.type);
                        onClose?.();
                    }}
                    className="text-left px-3 py-2 rounded-xl hover:bg-neutral-800 border border-white/5"
                >
                    {it.label}
                </button>
            ))}
            <div className="mt-4 text-xs text-neutral-500 px-1">
                HERE ↑ — capped to viewport with scroll
            </div>
        </nav>
    );
};

/*****************
 * Demo Tab Components (replace with real ones)
 *****************/

const ChatTab: React.FC<TabComponentProps> = ({ id, tab }) => {
    const { setTitle } = useTabManager();
    const [value, setValue] = useState("");

    // Example: first non-empty message sets tab title (once)
    useEffect(() => {
        if (tab.title === "New Chat" && value.trim().length > 0) {
            setTitle(id, value.trim().slice(0, 24));
        }
    }, [value, id, tab.title, setTitle]);

    return (
        <div className="p-4 space-y-3">
            <h2 className="text-lg font-semibold">Chat (demo)</h2>
            <textarea
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Type a message… First line will rename this tab."
                className="w-full h-40 p-3 rounded-xl bg-neutral-900 border border-white/10 outline-none focus:border-indigo-400"
            />
            <div className="text-xs text-neutral-500">Tab ID: {id}</div>
        </div>
    );
};

const SettingsTab: React.FC<TabComponentProps> = () => {
    return (
        <div className="p-4 space-y-2">
            <h2 className="text-lg font-semibold">Settings (demo)</h2>
            <p className="text-sm text-neutral-400">
                Move your existing Settings UI here as a tab.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="flex items-center gap-2 p-3 rounded-xl bg-neutral-900 border border-white/10">
                    <input type="checkbox" className="rounded" />
                    Dark mode
                </label>
                <label className="flex items-center gap-2 p-3 rounded-xl bg-neutral-900 border border-white/10">
                    <input type="checkbox" className="rounded" />
                    Enable experimental DAW
                </label>
            </div>
        </div>
    );
};

const PlaceholderTab: React.FC<TabComponentProps> = ({ tab }) => (
    <div className="p-6">
        <h2 className="text-lg font-semibold mb-2">{tab.title}</h2>
        <p className="text-sm text-neutral-400">
            This area is reserved for the {tab.type.toUpperCase()} module.
        </p>
    </div>
);

/*****************
 * Demo Registry
 *****************/

const registry: Registry = {
    chat: ChatTab,
    settings: SettingsTab,
    daw: PlaceholderTab,
    mixer: PlaceholderTab,
    market: PlaceholderTab,
    band: PlaceholderTab,
    artwork: PlaceholderTab,
    world: PlaceholderTab,
};

/*****************
 * App Shell (Preview)
 *****************/

const AppShell: React.FC = () => {
    const { openTab } = useTabManager();
    const [sidebarOpen, setSidebarOpen] = useState(false);

    const createTab = (type: TabType) => {
        const defaults: Record<TabType, string> = {
            chat: "New Chat",
            settings: "Settings",
            daw: "DAW",
            mixer: "Mixer",
            market: "Marketplace",
            band: "Band Creation",
            artwork: "Artwork Editor",
            world: "YSong World",
        };
        openTab({
            type,
            title: defaults[type],
            pinned: type === "chat" ? false : true,
        });
    };

    return (
        <div className="h-screen w-full bg-neutral-950 text-neutral-100 grid grid-cols-1 md:grid-cols-[240px_1fr]">
            {/* Mobile Top Bar */}
            <div className="md:hidden flex items-center justify-between px-3 py-2 border-b border-white/10">
                <button
                    onClick={() => setSidebarOpen(true)}
                    aria-label="Open menu"
                    className="px-2 py-1 rounded-md bg-neutral-800 border border-white/10"
                >
                    ☰
                </button>
                <div className="text-sm opacity-80">YSong</div>
                <button
                    onClick={() => createTab("chat")}
                    className="px-2 py-1 rounded-md bg-indigo-600 hover:bg-indigo-500"
                >
                    New
                </button>
            </div>

            {/* Sidebar (Desktop) */}
            <aside className="hidden md:block border-r border-white/10 bg-neutral-900/40">
                <div className="px-3 py-3 font-semibold">Menu</div>
                <SidebarMenu onOpen={createTab} />
            </aside>

            {/* Sidebar (Mobile Drawer) */}
            {sidebarOpen && (
                <div className="fixed inset-0 z-40 md:hidden">
                    <div
                        className="absolute inset-0 bg-black/60"
                        onClick={() => setSidebarOpen(false)}
                    />
                    <div className="absolute left-0 top-0 bottom-0 w-72 bg-neutral-900 border-r border-white/10 shadow-xl">
                        <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
                            <div className="font-semibold">Menu</div>
                            <button
                                onClick={() => setSidebarOpen(false)}
                                className="px-2 py-1 rounded-md bg-neutral-800 border border-white/10"
                            >
                                ✕
                            </button>
                        </div>
                        <SidebarMenu
                            onOpen={createTab}
                            onClose={() => setSidebarOpen(false)}
                        />
                    </div>
                </div>
            )}

            {/* Main */}
            <main className="flex flex-col min-h-0">
                <div className="hidden md:flex items-center justify-between px-2 py-2 border-b border-white/10 bg-neutral-900/60">
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => createTab("chat")}
                            className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm"
                        >
                            New
                        </button>
                        <button
                            onClick={() => createTab("settings")}
                            className="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 border border-white/10 text-sm"
                        >
                            Settings
                        </button>
                    </div>
                    <div className="text-sm opacity-60 pr-2">YSong Studio</div>
                </div>
                <TabBar />
                <TabContentHost />
            </main>
        </div>
    );
};

/*****************
 * Demo Entrypoint
 *****************/

export default function YSongTabDemo() {
    // Boot with one Chat (unpinned) + Settings (pinned)
    const bootTabs: TabRecord[] = [
        { id: uid(), type: "chat", title: "New Chat", pinned: false },
        { id: uid(), type: "settings", title: "Settings", pinned: true },
    ];

    return (
        <TabManagerProvider
            registry={registry}
            initialTabs={bootTabs}
            initialActiveId={bootTabs[0].id}
            persistKey="ysong.tabs"
        >
            <AppShell />
        </TabManagerProvider>
    );
}
