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
import { YSButton } from "../components/YSButton";

/* -------------------------------- Types --------------------------------- */

export type TabType = "chat" | "profile" | "settings" | "daw" | "mixer" | "visuals" | "createSong" | "band" | "singers" | "analytics" | "flashback" | "tools" | "artwork" | "library" | "achievements" | "rooms" | "market" | "world" | "radio" | "bridge" | "upload";

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
type Registry = Record<TabType, ComponentType<any>>;

/* ----------------------------- Context API ------------------------------ */

type HistoryMode = "push" | "replace" | "silent";

type Ctx = {
	tabs: TabRecord[];
	activeId: string | null;
	openTab: (spec: Omit<TabRecord, "id"> & { id?: string }, historyMode?: HistoryMode) => string;
	closeTab: (id: string) => void;
	activateTab: (id: string, historyMode?: HistoryMode) => void;
	updateTab: (id: string, patch: Partial<TabRecord>) => void;
	togglePin: (id: string) => void;
	reorderTab: (dragId: string, overId: string, place: DropPlace) => void;
};

const TabCtx = createContext<Ctx | null>(null);

export const useTabManager = (): Ctx => {
	const ctx = useContext(TabCtx);
	if (!ctx) throw new Error("useTabManager must be used inside TabManagerProvider");
	return ctx;
};

/* --------------------------- Provider (state) --------------------------- */

export function TabManagerProvider({ children }: { children: ReactNode }) {
	const [tabs, setTabs] = useState<TabRecord[]>([]);
	const [activeId, setActiveId] = useState<string | null>(null);
	const tabsRef = useRef<TabRecord[]>([]);
	const popApplyingRef = useRef(false);

	useEffect(() => { tabsRef.current = tabs; }, [tabs]);

	const historyUrlFor = useCallback((tab: TabRecord | null) => {
		if (typeof window === "undefined" || !window.location.pathname.startsWith("/app")) return null;
		const url = new URL(window.location.href);
		url.searchParams.delete("chat");
		if (!tab) url.searchParams.delete("view");
		else {
			url.searchParams.set("view", tab.type);
			if (tab.type === "chat" && tab.payload?.chatId) url.searchParams.set("chat", String(tab.payload.chatId));
		}
		return `${url.pathname}${url.search}${url.hash}`;
	}, []);

	const writeHistory = useCallback((tab: TabRecord | null, mode: HistoryMode = "push") => {
		if (mode === "silent" || popApplyingRef.current || typeof window === "undefined") return;
		const url = historyUrlFor(tab);
		if (!url) return;
		const state = tab
			? { ysongWorkspace: true, tabId: tab.id, tabType: tab.type, chatId: tab.payload?.chatId ?? null }
			: { ysongWorkspace: true, tabId: null, tabType: "home" };
		if (mode === "replace") window.history.replaceState(state, "", url);
		else window.history.pushState(state, "", url);
	}, [historyUrlFor]);

	const activateTab: Ctx["activateTab"] = useCallback((id, historyMode = "push") => {
		setActiveId(id);
		const tab = tabsRef.current.find((t) => t.id === id) || null;
		if (tab) writeHistory(tab, historyMode);
	}, [writeHistory]);

	const openTab: Ctx["openTab"] = useCallback((spec, historyMode = "push") => {
		const current = tabsRef.current;
		if (spec.type === "chat" && spec.payload?.chatId) {
			const existing = current.find((t) => t.type === "chat" && t.payload?.chatId === spec.payload.chatId);
			if (existing) {
				setActiveId(existing.id);
				writeHistory(existing, historyMode);
				return existing.id;
			}
		}
		const id = spec.id ?? crypto.randomUUID();
		const next = { id, ...spec } as TabRecord;
		setTabs((prev) => [...prev, next]);
		setActiveId(id);
		writeHistory(next, historyMode);
		return id;
	}, [writeHistory]);

	const closeTab: Ctx["closeTab"] = useCallback((id) => {
		setTabs((prev) => {
			const idx = prev.findIndex((t) => t.id === id);
			const next = prev.filter((t) => t.id !== id);
			if (id === activeId) {
				const fallback = next[idx - 1] ?? next[idx] ?? null;
				setActiveId(fallback?.id ?? null);
				writeHistory(fallback, "replace");
			}
			return next;
		});
	}, [activeId, writeHistory]);

	useEffect(() => {
		const onPopState = (event: PopStateEvent) => {
			if (!window.location.pathname.startsWith("/app")) return;
			const state = event.state;
			if (!state?.ysongWorkspace) return;
			popApplyingRef.current = true;
			try {
				if (!state.tabId) {
					setActiveId(null);
					return;
				}
				const exact = tabsRef.current.find((t) => t.id === state.tabId);
				if (exact) {
					setActiveId(exact.id);
					return;
				}
				const byShape = tabsRef.current.find((t) => t.type === state.tabType && (state.tabType !== "chat" || String(t.payload?.chatId || "") === String(state.chatId || "")));
				if (byShape) setActiveId(byShape.id);
			} finally {
				queueMicrotask(() => { popApplyingRef.current = false; });
			}
		};
		window.addEventListener("popstate", onPopState);
		return () => window.removeEventListener("popstate", onPopState);
	}, []);

	const updateTab: Ctx["updateTab"] = (id, patch) =>
		setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));

	const togglePin: Ctx["togglePin"] = (id) =>
		setTabs((prev) => {
			const t = prev.find((x) => x.id === id);
			if (!t) return prev;
			const pinned = !t.pinned;
			const rest = prev.filter((x) => x.id !== id);
			const nextTab = { ...t, pinned };
			const pinSplit = rest.findIndex((x) => !x.pinned);
			if (pinned) {
				if (pinSplit === -1) return [...rest, nextTab];
				return [...rest.slice(0, pinSplit), nextTab, ...rest.slice(pinSplit)];
			}
			if (pinSplit === -1) return [nextTab, ...rest];
			return [...rest.slice(0, pinSplit), ...rest.slice(pinSplit), nextTab];
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
			const remove = (arr: TabRecord[], itemId: string) => { const i = arr.findIndex((t) => t.id === itemId); if (i >= 0) arr.splice(i, 1); };
			const insertAtRef = (arr: TabRecord[], refId: string, d: TabRecord, where: DropPlace) => { const j = arr.findIndex((t) => t.id === refId); const at = j < 0 ? arr.length : where === "before" ? j : j + 1; arr.splice(at, 0, d); };
			remove(P, dragId); remove(U, dragId);
			const dropped = { ...drag, pinned: !!over.pinned };
			if (over.pinned) insertAtRef(P, overId, dropped, place);
			else insertAtRef(U, overId, dropped, place);
			return [...P, ...U];
		});

	const value = useMemo(() => ({ tabs, activeId, openTab, closeTab, activateTab, updateTab, togglePin, reorderTab }), [tabs, activeId, openTab, closeTab, activateTab]);

	return <TabCtx.Provider value={value}>{children}</TabCtx.Provider>;
}

/* ----------------------------- UI components ---------------------------- */

export function TabBar() {
	const { tabs, activeId, activateTab, closeTab, togglePin, reorderTab } = useTabManager();

	// hooks must run on every render
	const [draggingId, setDraggingId] = useState<string | null>(null);
	const [over, setOver] = useState<{ id: string; side: DropPlace } | null>(null);
	const barRef = useRef<HTMLDivElement | null>(null);

	const onDragStart = useCallback((id: string, e: React.DragEvent) => {
		setDraggingId(id);
		e.dataTransfer.setData("text/tab-id", id);
		e.dataTransfer.effectAllowed = "move";
	}, []);

	const onDragOver = useCallback((id: string, e: React.DragEvent) => {
		e.preventDefault();
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const side: DropPlace = e.clientX < rect.left + rect.width / 2 ? "before" : "after";
		setOver({ id, side });
		e.dataTransfer.dropEffect = "move";
	}, []);

	const onDrop = useCallback(
		(id: string, e: React.DragEvent) => {
			e.preventDefault();
			const dragged = e.dataTransfer.getData("text/tab-id") || draggingId;
			if (dragged) {
				const side = over && over.id === id ? over.side : ("after" as DropPlace);
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

	useEffect(() => {
		const el = barRef.current?.querySelector<HTMLElement>('[data-active="true"]');
		el?.scrollIntoView({
			inline: "nearest",
			block: "nearest",
			behavior: "smooth",
		});
	}, [activeId, tabs.length]);

	// you can still bail out of rendering *after* all hooks ran
	if (tabs.length === 0) {
		return (
			<div className="pl-2 pr-14 border-b bg-white/75 dark:bg-neutral-950/60 border-neutral-200 dark:border-neutral-800 backdrop-blur supports-[backdrop-filter]:backdrop-blur-md" />
		);
	}

	const pinned = tabs.filter((t) => t.pinned);
	const unpinned = tabs.filter((t) => !t.pinned);
	const ordered = [...pinned, ...unpinned];

	return (
		<div className="pl-2 pr-14 border-b bg-white/75 dark:bg-neutral-950/60 border-neutral-200 dark:border-neutral-800 backdrop-blur supports-[backdrop-filter]:backdrop-blur-md">
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
					const showLeft = over?.id === t.id && over.side === "before";
					const showRight = over?.id === t.id && over.side === "after";
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
									e.preventDefault();
									closeTab(t.id);
								}
							}}
							className={`relative group rounded-lg border select-none ${
								isActive
									? "bg-white text-neutral-900 border-neutral-300 dark:bg-neutral-900 dark:text-white dark:border-neutral-700"
									: "bg-white/85 text-neutral-700 hover:bg-neutral-50 border-neutral-300 dark:bg-neutral-900/70 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:border-neutral-800"
							}`}
							tabIndex={0}
							onKeyDown={(e) => {
								// Activate with Enter or Space for keyboard users
								if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
									e.preventDefault();
									activateTab(t.id);
								}
							}}
							onClick={() => activateTab(t.id)}
							title={t.title}
						>
							{showLeft && (
								<span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[2px] bg-indigo-500 rounded-sm" />
							)}
							{showRight && (
								<span className="absolute right-0 top-1/2 -translate-y-1/2 h-5 w-[2px] bg-indigo-500 rounded-sm" />
							)}

							<div className="pl-3 pr-2 py-1.5 rounded-lg flex items-center gap-2">
								<span className="truncate max-w-[22ch]">{t.title}</span>
								<YSButton
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
								</YSButton>
								<YSButton
									type="button"
									className="opacity-60 hover:opacity-100 text-neutral-500 dark:text-neutral-400"
									title="Close"
									onClick={(e) => {
										e.stopPropagation();
										closeTab(t.id);
									}}
								>
									×
								</YSButton>
							</div>

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

export function TabContentHost({ registry, extraProps }: { registry: Registry; extraProps?: Record<string, any> }) {
	const { tabs, activeId } = useTabManager();
	const activeTab = tabs.find((t) => t.id === activeId) ?? null;
	if (!activeTab) return null;

	// The DAW is a persistent studio session, not a disposable page. Once opened it
	// stays mounted while the user visits Mixer, Chat, Settings, etc., so playback,
	// VST instances and WebAudio graphs do not restart simply because the view changed.
	const keptAlive = tabs.filter((tab) => tab.type === "daw");
	const activeIsKeptAlive = activeTab.type === "daw";
	const Active = registry[activeTab.type];

	return (
		<div className="flex-1 min-h-0 relative">
			{keptAlive.map((tab) => {
				const C = registry[tab.type];
				const visible = tab.id === activeId;
				return <div key={tab.id} className={`absolute inset-0 min-h-0 ${visible ? "block" : "hidden"}`}><C tab={tab} {...(extraProps ?? {})} /></div>;
			})}
			{!activeIsKeptAlive && <div className="absolute inset-0 min-h-0"><Active tab={activeTab} {...(extraProps ?? {})} /></div>}
		</div>
	);
}
