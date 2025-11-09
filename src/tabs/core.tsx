// src/tabs/core.tsx
import React, {
    createContext,
    useContext,
    useMemo,
    useState,
    useCallback,
    useRef,
    useEffect,
    type ReactNode,
    type ComponentType,
} from "react";

/* -------------------------------- Types --------------------------------- */

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
    id: string;
    type: TabType;
    title: string;
    pinned?: boolean;
    payload?: any;
};

type DropPlace = "before" | "after";

/** The props every tab renderer receives */
export type TabRendererProps = { tab: TabRecord };

/** Internal registry type used by TabContentHost */
type Registry = Record<TabType, ComponentType<TabRendererProps>>;

/* ----------------------------- Context API ------------------------------ */

type Ctx = {
    tabs: TabRecord[];
    activeId: string | null;
    openTab: (spec: Omit<TabRecord, "id"> & { id?: string }) => string;
    closeTab: (id: string) => void;
    activateTab: (id: string) => void;
    updateTab: (id: string, patch: Partial<TabRecord>) => void;
    togglePin: (id: string) => void;
    reorderTab: (dragId: string, overId: string, place: DropPlace) => void;
};

const TabCtx = createContext<Ctx | null>(null);

export const useTabManager = (): Ctx => {
    const ctx = useContext(TabCtx);
    if (!ctx)
        throw new Error("useTabManager must be used inside TabManagerProvider");
    return ctx;
};

/* --------------------------- Provider (state) --------------------------- */

const ALL_TYPES: TabType[] = [
    "chat",
    "settings",
    "daw",
    "mixer",
    "market",
    "band",
    "artwork",
    "world",
];

const LS_TABS = "ysong.tabs";
const LS_ACTIVE = "ysong.activeTabId";

export function TabManagerProvider({ children }: { children: ReactNode }) {
    const [tabs, setTabs] = useState<TabRecord[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);

    // Restore from localStorage (if available)
    useEffect(() => {
        try {
            const raw = localStorage.getItem(LS_TABS);
            if (!raw) return;
            const restored = JSON.parse(raw) as TabRecord[];
            const safe = restored.filter((t) => ALL_TYPES.includes(t.type));
            setTabs(safe);
            const savedActive = localStorage.getItem(LS_ACTIVE);
            if (savedActive && safe.some((t) => t.id === savedActive)) {
                setActiveId(savedActive);
            } else if (safe[0]) {
                setActiveId(safe[0].id);
            }
        } catch {
            // ignore
        }
    }, []);

    // Persist to localStorage
    useEffect(() => {
        try {
            localStorage.setItem(LS_TABS, JSON.stringify(tabs));
            localStorage.setItem(LS_ACTIVE, activeId ?? "");
        } catch {
            // ignore
        }
    }, [tabs, activeId]);

    const openTab: Ctx["openTab"] = (spec) => {
        const id = spec.id ?? crypto.randomUUID();
        setTabs((prev) => {
            // De-dupe Chat tabs by chatId if provided
            if (spec.type === "chat" && spec.payload?.chatId) {
                const existing = prev.find(
                    (t) =>
                        t.type === "chat" &&
                        t.payload?.chatId === spec.payload.chatId
                );
                if (existing) {
                    setActiveId(existing.id);
                    return prev;
                }
            }
            return [...prev, { id, ...spec }];
        });
        setActiveId(id);
        return id;
    };

    const closeTab: Ctx["closeTab"] = (id) => {
        setTabs((prev) => {
            const idx = prev.findIndex((t) => t.id === id);
            const next = prev.filter((t) => t.id !== id);
            if (id === activeId) {
                const fallback = next[idx - 1] ?? next[idx] ?? null;
                setActiveId(fallback?.id ?? null);
            }
            return next;
        });
    };

    const activateTab: Ctx["activateTab"] = (id) => setActiveId(id);

    const updateTab: Ctx["updateTab"] = (id, patch) =>
        setTabs((prev) =>
            prev.map((t) => (t.id === id ? { ...t, ...patch } : t))
        );

    const togglePin: Ctx["togglePin"] = (id) =>
        setTabs((prev) => {
            const t = prev.find((x) => x.id === id);
            if (!t) return prev;
            const pinned = !t.pinned;

            // remove from list
            const rest = prev.filter((x) => x.id !== id);
            const nextTab = { ...t, pinned };

            // where to reinsert:
            const pinSplit = rest.findIndex((x) => !x.pinned); // first unpinned
            if (pinned) {
                // append to end of pinned segment
                if (pinSplit === -1) return [...rest, nextTab]; // all pinned already
                return [
                    ...rest.slice(0, pinSplit),
                    nextTab,
                    ...rest.slice(pinSplit),
                ];
            } else {
                // move just after pinned segment
                if (pinSplit === -1) return [nextTab, ...rest]; // no unpinned yet
                return [
                    ...rest.slice(0, pinSplit),
                    ...rest.slice(pinSplit),
                    nextTab,
                ];
            }
        });

    const reorderTab: Ctx["reorderTab"] = (dragId, overId, place) =>
        setTabs((prev) => {
            if (dragId === overId) return prev;

            const byId = Object.fromEntries(prev.map((t) => [t.id, t]));
            const drag = byId[dragId];
            const over = byId[overId];
            if (!drag || !over) return prev;

            const pinnedList = prev.filter((t) => t.pinned);
            const unpinnedList = prev.filter((t) => !t.pinned);

            const clone = (arr: TabRecord[]) => arr.map((x) => ({ ...x }));

            let P = clone(pinnedList);
            let U = clone(unpinnedList);

            const remove = (arr: TabRecord[], id: string) => {
                const i = arr.findIndex((t) => t.id === id);
                if (i >= 0) arr.splice(i, 1);
            };
            const insertAtRef = (
                arr: TabRecord[],
                refId: string,
                d: TabRecord,
                where: DropPlace
            ) => {
                const j = arr.findIndex((t) => t.id === refId);
                const at = j < 0 ? arr.length : where === "before" ? j : j + 1;
                arr.splice(at, 0, d);
            };

            // remove drag from whichever list it's in
            remove(P, dragId);
            remove(U, dragId);

            // dropping adopts the pinned state of the target
            const dropped = { ...drag, pinned: !!over.pinned };
            if (over.pinned) insertAtRef(P, overId, dropped, place);
            else insertAtRef(U, overId, dropped, place);

            return [...P, ...U];
        });

    const value = useMemo(
        () => ({
            tabs,
            activeId,
            openTab,
            closeTab,
            activateTab,
            updateTab,
            togglePin,
            reorderTab,
        }),
        [tabs, activeId]
    );

    return <TabCtx.Provider value={value}>{children}</TabCtx.Provider>;
}

/* ----------------------------- UI components ---------------------------- */

export function TabBar() {
    const { tabs, activeId, activateTab, closeTab, togglePin, reorderTab } =
        useTabManager();

    if (tabs.length === 0) return null;

    // DnD state
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [over, setOver] = useState<{ id: string; side: DropPlace } | null>(
        null
    );

    const onDragStart = useCallback((id: string, e: React.DragEvent) => {
        setDraggingId(id);
        e.dataTransfer.setData("text/tab-id", id);
        e.dataTransfer.effectAllowed = "move";
    }, []);

    const onDragOver = useCallback((id: string, e: React.DragEvent) => {
        e.preventDefault();
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const side: DropPlace =
            e.clientX < rect.left + rect.width / 2 ? "before" : "after";
        setOver({ id, side });
        e.dataTransfer.dropEffect = "move";
    }, []);

    const onDrop = useCallback(
        (id: string, e: React.DragEvent) => {
            e.preventDefault();
            const dragged = e.dataTransfer.getData("text/tab-id") || draggingId;
            if (dragged) {
                const side =
                    over && over.id === id ? over.side : ("after" as DropPlace);
                reorderTab(dragged, id, side);
            }
            setDraggingId(null);
            setOver(null);
        },
        [draggingId, over, reorderTab]
    );

    const onDragEnd = useCallback(() => {
        setDraggingId(null);
        setOver(null);
    }, []);

    // Keep pinned on left
    const pinned = tabs.filter((t) => t.pinned);
    const unpinned = tabs.filter((t) => !t.pinned);
    const ordered = [...pinned, ...unpinned];

    // Auto-scroll & natural wheel scrolling
    const barRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const el = barRef.current?.querySelector<HTMLElement>(
            '[data-active="true"]'
        );
        el?.scrollIntoView({
            inline: "nearest",
            block: "nearest",
            behavior: "smooth",
        });
    }, [activeId, tabs.length]);

    return (
        <div
            className="px-2 border-b bg-white/75 dark:bg-neutral-950/60
                 border-neutral-200 dark:border-neutral-800
                 backdrop-blur supports-[backdrop-filter]:backdrop-blur-md"
        >
            <div
                ref={barRef}
                className="flex gap-1 items-end overflow-x-auto no-scrollbar py-2"
                onWheel={(e) => {
                    if (e.deltaY) {
                        e.currentTarget.scrollLeft += e.deltaY;
                        e.preventDefault();
                    }
                }}
            >
                {ordered.map((t) => {
                    const isActive = activeId === t.id;
                    const showLeft =
                        over?.id === t.id && over.side === "before";
                    const showRight =
                        over?.id === t.id && over.side === "after";
                    return (
                        <div
                            key={t.id}
                            data-active={isActive ? "true" : "false"}
                            data-tabid={t.id}
                            draggable
                            onDragStart={(e) => onDragStart(t.id, e)}
                            onDragOver={(e) => onDragOver(t.id, e)}
                            onDrop={(e) => onDrop(t.id, e)}
                            onDragEnd={onDragEnd}
                            onMouseDown={(e) => {
                                if (e.button === 1) {
                                    // middle-click closes
                                    e.preventDefault();
                                    closeTab(t.id);
                                }
                            }}
                            className={`relative group rounded-lg border select-none
                  ${
                      isActive
                          ? "bg-white text-neutral-900 border-neutral-300 " +
                            "dark:bg-neutral-900 dark:text-white dark:border-neutral-700"
                          : "bg-white/85 text-neutral-700 hover:bg-neutral-50 border-neutral-300 " +
                            "dark:bg-neutral-900/70 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:border-neutral-800"
                  }`}
                            role="button"
                            onClick={() => activateTab(t.id)}
                            title={t.title}
                        >
                            {/* drop indicators */}
                            {showLeft && (
                                <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[2px] bg-indigo-500 rounded-sm" />
                            )}
                            {showRight && (
                                <span className="absolute right-0 top-1/2 -translate-y-1/2 h-5 w-[2px] bg-indigo-500 rounded-sm" />
                            )}

                            <div className="pl-3 pr-2 py-1.5 rounded-lg flex items-center gap-2">
                                <span className="truncate max-w-[22ch]">
                                    {t.title}
                                </span>

                                {/* pin toggle */}
                                <button
                                    type="button"
                                    className={`opacity-70 hover:opacity-100 transition ${
                                        t.pinned
                                            ? "text-indigo-600 dark:text-indigo-300"
                                            : "text-neutral-500 dark:text-neutral-400"
                                    }`}
                                    title={t.pinned ? "Unpin" : "Pin"}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        togglePin(t.id);
                                    }}
                                >
                                    {/* pushpin icon */}
                                    <svg
                                        width="14"
                                        height="14"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    >
                                        <path d="M14 9l7-7" />
                                        <path d="M3 21l10-10" />
                                        <path d="M15 7l2 2" />
                                        <path d="M7 15l2 2" />
                                    </svg>
                                </button>

                                {/* close */}
                                <button
                                    type="button"
                                    className="opacity-60 hover:opacity-100 text-neutral-500 dark:text-neutral-400"
                                    title="Close"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        closeTab(t.id);
                                    }}
                                >
                                    ×
                                </button>
                            </div>

                            {/* active underline */}
                            {isActive && (
                                <div className="h-[2px] w-full bg-indigo-600 dark:bg-indigo-400 rounded-b-lg" />
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export function TabContentHost({ registry }: { registry: Registry }) {
    const { tabs, activeId } = useTabManager();
    const tab = tabs.find((t) => t.id === activeId) ?? null;
    if (!tab) return null;
    const C = registry[tab.type];
    return (
        <div className="flex-1 min-h-0">
            <C tab={tab} />
        </div>
    );
}
