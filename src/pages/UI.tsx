// src/pages/UI.tsx
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { apiGet, apiPost, clearToken } from "../lib/authApi";
import { loadUserSettings } from "../lib/userPrefsApi";
import UISidebar, { type Chat } from "../components/UISidebar";
import {
	TabManagerProvider,
	TabBar,
	TabContentHost,
	useTabManager,
	type TabType,
} from "../tabs/core";
import ChatPane, { YSONG_WELCOME } from "../tabs/ChatPane";
import SettingsPane from "../tabs/SettingsPane";
import ProfilePane from "../tabs/Profile";
import BottomDrawers from "../components/BottomDrawers";
import { WorldPlayerDock, WorldPlayerProvider, useWorldPlayer } from "../components/WorldPlayer";
import type { ProjectAsset } from "../components/ProjectAssetDrawer";
import { YSButton } from "../components/YSButton";
import type { DrawerAsset } from "../components/AssetDrawer";
import DAWPane from "../tabs/DAW";
import MixerPane from "../tabs/Mixer";
import VisualsPane from "../tabs/Visuals";
import MarketplacePane from "../tabs/Marketplace";
import CreateSongPane from "../tabs/CreateSong";
import BandCreationPane from "../tabs/BandCreation";
import ArtworkStudioPane from "../tabs/ArtworkStudio";
import WorldPane from "../tabs/World";
import RadioPane from "../tabs/Radio";
import BridgePane from "../tabs/Bridge";
import UploadMusicPane from "../tabs/UploadMusic";
import LibraryPane from "../tabs/Library";
import AchievementsPane from "../tabs/Achievements";
import SingerStudioPane from "../tabs/SingerStudio";
import AnalyticsPane from "../tabs/Analytics";
import FlashbackPane from "../tabs/Flashback";
import ToolsPane from "../tabs/Tools";
import RoomsPane from "../tabs/Rooms";
import { signedProfileAssetUrl } from "../lib/profileApi";
import NotificationBell from "../components/NotificationBell";
import { fetchChatMessages } from "../lib/chatApi";

const ZWSP = "\u200B";

/* ---------- tiny hook: >= 1024px (Tailwind lg) ---------- */
function useMediaQuery(query: string) {
	const getMatch = () => (typeof window !== "undefined" ? window.matchMedia(query).matches : false);
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

/* Restores saved tabs; otherwise leaves the Home surface visible. */
function BootTabs({
	me,
	chats,
	chatsHydrated,
	onLayoutHydrated,
}: {
	me: { email: string; displayName: string } | null;
	chats: Chat[];
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
				const data = await apiGet<{ tabs?: any[]; activeId?: string }>("/api/ui/layout");

				if (data?.tabs && data.tabs.length > 0) {
					// Only restore chat tabs whose chatId actually exists in Neon
					const knownChatIds = new Set(chats.map((c) => c.id));

					const filteredTabs = (data.tabs as any[]).filter((t) => {
						if (t.type !== "chat") return true;
						const chatId = t.payload?.chatId;
						return chatId && knownChatIds.has(chatId);
					});

					const MODULE_TITLES: Record<string, string> = {
						profile: "Profile",
						settings: "Settings",
						daw: "DAW",
						mixer: "Mixer",
						visuals: "Visuals",
						createSong: "Create Song",
						band: "Band Creation",
						singers: "Singer Studio",
						analytics: "Analytics",
						flashback: "Flashback",
						tools: "Tools",
						artwork: "Artwork Studio",
						library: "My Library",
						achievements: "Achievements",
						rooms: "Rooms",
						market: "Marketplace",
						world: "YSong World",
						radio: "YSong Radio",
						bridge: "YSong Bridge",
						upload: "Upload Music",
					};

					const normalizeRestoredTab = (t: any) => {
						let type = String(t?.type ?? "");
						// one-time migration: old tab name -> new tab name
						if (type === "content") type = "library";

						let title = typeof t?.title === "string" ? t.title.trim() : "";
						if (!title) title = MODULE_TITLES[type] ?? "Tab";

						return { ...t, type, title };
					};

					const normalizedTabs = filteredTabs.map(normalizeRestoredTab);

					if (normalizedTabs.length > 0) {
						normalizedTabs.forEach((t) => openTab(t as any, "silent"));

						let activeId = data.activeId;
						if (!activeId || !normalizedTabs.some((t) => t.id === activeId)) {
							activeId = normalizedTabs[0].id;
						}
						if (activeId) activateTab(activeId, "silent");
						restored = true;
					}
				}
			} catch (err) {
				console.warn("Failed to restore tab layout", err);
			}

			if (!restored) {
				// Leave the tab strip empty on a fresh account or a deliberately cleared
				// workspace. PlayerAwareMain renders the YSong Home surface instead of
				// dropping the user into a blank canvas or manufacturing a chat.
			}

			onLayoutHydrated();
		})();
	}, [chatsHydrated, me, tabs.length, chats, openTab, activateTab, onLayoutHydrated]);

	return null;
}

function SyncActiveChatFromTabs({
	activeChatId,
	setActiveChatId,
}: {
	activeChatId: string;
	setActiveChatId: (id: string) => void;
}) {
	const { tabs, activeId } = useTabManager();

	useEffect(() => {
		const t = tabs.find((x) => x.id === activeId);
		const next = t?.type === "chat" && t.payload?.chatId ? String(t.payload.chatId) : "";

		if (next && next !== activeChatId) setActiveChatId(next);
	}, [tabs, activeId, activeChatId, setActiveChatId]);

	return null;
}

function normalizeAttachment(raw: any) {
	if (!raw) return null;
	const name = typeof raw.name === "string" ? raw.name : "file";
	const size = typeof raw.size === "number" ? raw.size : Number(raw.size ?? 0);
	const type = typeof raw.type === "string" ? raw.type : "application/octet-stream";
	const objectKey = typeof raw.objectKey === "string" ? raw.objectKey : undefined;
	const publicUrl = typeof raw.publicUrl === "string" ? raw.publicUrl : undefined;
	return { name, size, type, objectKey, publicUrl };
}

function uploadLabel(n: number) {
	return n === 1 ? "(uploaded 1 file)" : `(uploaded ${n} files)`;
}

function PrefetchChatMessagesFromTabs({
	enabled,
	chatsHydrated,
	chats,
	setChats,
}: {
	enabled: boolean;
	chatsHydrated: boolean;
	chats: Chat[];
	setChats: Dispatch<SetStateAction<Chat[]>>;
}) {
	const { tabs } = useTabManager();
	const fetched = useRef<Set<string>>(new Set());

	useEffect(() => {
		if (!enabled) return;
		if (!chatsHydrated) return;

		const ids = Array.from(
			new Set(tabs.filter((t) => t.type === "chat" && t.payload?.chatId).map((t) => String(t.payload.chatId)))
		);

		if (ids.length === 0) return;

		ids.forEach((chatId) => {
			if (fetched.current.has(chatId)) return;

			const chat = chats.find((c) => c.id === chatId);
			if (!chat) return;

			// If we already have DB ids or attachments, assume loaded.
			const msgs: any[] = Array.isArray((chat as any).messages) ? (chat as any).messages : [];
			const looksLoaded =
				msgs.some((m) => typeof m?.id === "string") ||
				msgs.some((m) => Array.isArray(m?.attachments) && m.attachments.length > 0);

			if (looksLoaded) {
				fetched.current.add(chatId);
				return;
			}

			fetched.current.add(chatId);

			(async () => {
				try {
					const dbMessages: any[] = await fetchChatMessages(chatId);

					setChats((prev) =>
						prev.map((c) => {
							if (c.id !== chatId) return c;

							const mapped = (dbMessages || []).map((m) => {
								const raw = typeof m?.content === "string" ? m.content : "";
								const atts = Array.isArray(m?.attachments)
									? m.attachments.map(normalizeAttachment).filter(Boolean)
									: [];
								const text = raw === ZWSP && atts.length ? uploadLabel(atts.length) : raw;

								return {
									id: m?.id,
									role: m?.role,
									text,
									ts: m?.createdAt ? new Date(m.createdAt).getTime() : Date.now(),
									attachments: atts,
									personaId: m?.personaId || null,
								};
							});

							return { ...c, messages: mapped } as any;
						})
					);
				} catch (e) {
					console.error("Failed to prefetch chat messages", e);
					fetched.current.delete(chatId);
				}
			})();
		});
	}, [enabled, chatsHydrated, tabs, chats, setChats]);

	return null;
}

type ShellUserIdentity = {
	id: string;
	email: string;
	displayName: string;
	avatarObjectKey?: string;
	avatarUrl?: string;
};

type UIShellUser = {
	id: string;
	email: string;
	displayName?: string;
	avatarObjectKey?: string;
};

export default function UI({ currentUser = null }: { currentUser?: UIShellUser | null }) {
	const [me, setMe] = useState<ShellUserIdentity | null>(() => currentUser?.id ? {
		id: currentUser.id,
		email: currentUser.email,
		displayName: currentUser.displayName || currentUser.email?.split("@")[0] || "User",
		avatarObjectKey: currentUser.avatarObjectKey || "",
		avatarUrl: "",
	} : null);

	const [chats, setChats] = useState<Chat[]>([]);
	const [chatsHydrated, setChatsHydrated] = useState(false);
	const [activeId, setActiveId] = useState("");
	const [layoutHydrated, setLayoutHydrated] = useState(false);
	const [saveChatsEnabled, setSaveChatsEnabled] = useState(false);

	// responsive sidebar/drawer. Both desktop and mobile start collapsed so the
	// workspace gets the maximum amount of screen real estate by default.
	const isLgUp = useMediaQuery("(min-width: 1024px)");
	const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
	const [desktopSidebarOpen, setDesktopSidebarOpen] = useState<boolean>(() => {
		try { return sessionStorage.getItem("ysong:sidebar:desktopOpen") === "1"; } catch { return false; }
	});

	// The app shell already validates /auth/me before rendering the workspace. Use
	// that confirmed identity immediately, then refresh it here for profile/avatar
	// changes. A transient second request must never strand the sidebar at "...".
	useEffect(() => {
		if (!currentUser?.id) return;
		let alive = true;
		const base: ShellUserIdentity = {
			id: currentUser.id,
			email: currentUser.email,
			displayName: currentUser.displayName || currentUser.email?.split("@")[0] || "User",
			avatarObjectKey: currentUser.avatarObjectKey || "",
			avatarUrl: "",
		};

		setMe((prev) => ({ ...base, avatarUrl: prev?.id === base.id ? prev.avatarUrl || "" : "" }));
		if (base.avatarObjectKey) {
			void signedProfileAssetUrl(base.avatarObjectKey).then((avatarUrl) => {
				if (alive) setMe((prev) => prev?.id === base.id ? { ...prev, ...base, avatarUrl } : { ...base, avatarUrl });
			}).catch(() => {});
		}
		return () => { alive = false; };
	}, [currentUser?.id, currentUser?.email, currentUser?.displayName, currentUser?.avatarObjectKey]);

	useEffect(() => {
		let alive = true;
		let retryTimer: number | null = null;
		let retryMs = 750;

		const load = async () => {
			try {
				const u = await apiGet<{ ok: boolean; user: { id: string; email: string; displayName: string; avatarObjectKey?: string } }>("/auth/me");
				if (!alive || !u?.user?.id) return;
				const base: ShellUserIdentity = {
					id: u.user.id,
					email: u.user.email,
					displayName: u.user.displayName || u.user.email?.split("@")[0] || "User",
					avatarObjectKey: u.user.avatarObjectKey || "",
					avatarUrl: "",
				};

				// Commit the name immediately. Avatar URL signing is allowed to fail
				// independently without erasing an otherwise valid identity.
				setMe((prev) => ({ ...base, avatarUrl: prev?.id === base.id && prev.avatarObjectKey === base.avatarObjectKey ? prev.avatarUrl || "" : "" }));
				if (base.avatarObjectKey) {
					const avatarUrl = await signedProfileAssetUrl(base.avatarObjectKey).catch(() => "");
					if (alive && avatarUrl) setMe((prev) => prev?.id === base.id ? { ...prev, avatarUrl } : { ...base, avatarUrl });
				}
				retryMs = 750;
			} catch {
				// RequireAuth already owns invalid-session redirects. Here we only
				// recover from a transient local API/profile fetch failure.
				if (!alive) return;
				retryTimer = window.setTimeout(() => void load(), retryMs);
				retryMs = Math.min(retryMs * 2, 8000);
			}
		};

		const refresh = () => {
			if (retryTimer != null) { window.clearTimeout(retryTimer); retryTimer = null; }
			retryMs = 750;
			void load();
		};
		const onVisible = () => { if (document.visibilityState === "visible") refresh(); };

		void load();
		window.addEventListener("ysong:profile-changed", refresh);
		window.addEventListener("focus", refresh);
		document.addEventListener("visibilitychange", onVisible);
		return () => {
			alive = false;
			if (retryTimer != null) window.clearTimeout(retryTimer);
			window.removeEventListener("ysong:profile-changed", refresh);
			window.removeEventListener("focus", refresh);
			document.removeEventListener("visibilitychange", onVisible);
		};
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

				setSaveChatsEnabled(!!settings?.saveChats);

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

	// --- sidebar UX ---
	useEffect(() => {
		try { sessionStorage.setItem("ysong:sidebar:desktopOpen", desktopSidebarOpen ? "1" : "0"); } catch {}
	}, [desktopSidebarOpen]);

	useEffect(() => {
		if (!isLgUp && mobileSidebarOpen) setMobileSidebarOpen(false);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [activeId]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMobileSidebarOpen(false);
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

	// Never let the browser navigate to / play a file just because the user
	// missed a DAW lane or drawer by a few pixels. Child drop targets still
	// handle the same event normally; this only suppresses the browser default.
	useEffect(() => {
		const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types || []).includes("Files");
		const preventFileNavigation = (e: DragEvent) => {
			if (hasFiles(e)) e.preventDefault();
		};
		window.addEventListener("dragover", preventFileNavigation);
		window.addEventListener("drop", preventFileNavigation);
		return () => {
			window.removeEventListener("dragover", preventFileNavigation);
			window.removeEventListener("drop", preventFileNavigation);
		};
	}, []);

	function SeedWorkspaceHistory({ ready }: { ready: boolean }) {
		const { tabs, activeId, activateTab } = useTabManager();
		const seeded = useRef(false);
		useEffect(() => {
			if (!ready || seeded.current) return;
			seeded.current = true;
			if (activeId && tabs.some((tab) => tab.id === activeId)) activateTab(activeId, "replace");
			else if (window.location.pathname.startsWith("/app")) {
				const url = new URL(window.location.href);
				url.searchParams.delete("view"); url.searchParams.delete("chat");
				window.history.replaceState({ ysongWorkspace: true, tabId: null, tabType: "home" }, "", `${url.pathname}${url.search}`);
			}
		}, [ready, tabs, activeId, activateTab]);
		return null;
	}

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
		profile: ProfilePane,
		settings: SettingsPane,
		daw: DAWPane,

		// These are lightweight stubs; leaving them as trivial components is fine.
		mixer: MixerPane,
		visuals: VisualsPane,
		createSong: CreateSongPane,
		band: BandCreationPane,
		singers: SingerStudioPane,
		analytics: AnalyticsPane,
		flashback: FlashbackPane,
		tools: ToolsPane,
		artwork: ArtworkStudioPane,
		library: LibraryPane,
		achievements: AchievementsPane,
		rooms: RoomsPane,
		market: MarketplacePane,
		world: WorldPane,
		radio: RadioPane,
		bridge: BridgePane,
		upload: UploadMusicPane,
	} as const;

	/* Bridge so UISidebar buttons open/activate tabs */
	function SidebarWithTabsBridge(p: {
		meDisplayName?: string | null;
		meAvatarUrl?: string | null;
		chats: Chat[];
		activeId: string;
		setActiveId: (id: string) => void;
		setChats: Dispatch<SetStateAction<Chat[]>>;
		onLogout: () => void;
		onNavigate?: () => void;
	}) {
		const { tabs, openTab, activateTab, updateTab, closeTab } = useTabManager();

		const smartTitle = (c: Chat) => {
			const fromTitle = (c.title ?? "").trim();
			if (fromTitle) return fromTitle.slice(0, 48);

			const msgs = Array.isArray(c.messages) ? c.messages : [];
			const fromUser = msgs.find((m: any) => m.role === "user")?.text ?? "";
			return (fromUser || "New Chat").slice(0, 48);
		};

		const onOpenChatTab = (c: Chat) => {
			const existing = tabs.find((t) => t.type === "chat" && t.payload?.chatId === c.id);
			if (existing) activateTab(existing.id);
			else {
				openTab({
					type: "chat",
					title: smartTitle(c),
					payload: { chatId: c.id },
				});
			}
			p.onNavigate?.();
		};

		const onOpenModule = (type: Exclude<TabType, "chat"> | "chat") => {
			if (type === "chat") {
				const id = crypto.randomUUID();
				const newChat: Chat = {
					id,
					title: "",
					messages: [{ role: "assistant", text: YSONG_WELCOME }] as any[],
				};
				p.setChats((current) => [newChat, ...current]);
				openTab({
					type: "chat",
					title: "New Chat",
					payload: { chatId: id },
				});
				p.onNavigate?.();
				return;
			}
			// Mixer controls the live DAW session. If Mixer is the first studio view the
			// user opens, quietly create the DAW session tab first and leave Mixer active.
			if (type === "mixer" && !tabs.some((tab) => tab.type === "daw")) {
				openTab({ type: "daw", title: "DAW", pinned: true });
			}

			const titles = {
				profile: "Profile",
				settings: "Settings",
				daw: "DAW",
				mixer: "Mixer",
				visuals: "Visuals",
				createSong: "Create Song",
				band: "Band Creation",
				singers: "Singer Studio",
				analytics: "Analytics",
				flashback: "Flashback",
				tools: "Tools",
				artwork: "Artwork Studio",
				library: "My Library",
				achievements: "Achievements",
				rooms: "Rooms",
				market: "Marketplace",
				world: "YSong World",
				radio: "YSong Radio",
				bridge: "YSong Bridge",
				upload: "Upload Music",
			} as const;
			const existing = tabs.find((t) => t.type === type);
			if (existing) activateTab(existing.id);
			else openTab({ type, title: titles[type], pinned: true });
			p.onNavigate?.();
		};

		const handleRenameChat = (chatId: string, newTitle: string) => {
			p.setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, title: newTitle } : c)));
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

			tabs.filter((t) => t.type === "chat" && t.payload?.chatId === chatId).forEach((t) => closeTab(t.id));

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
				meDisplayName={p.meDisplayName}
				meAvatarUrl={p.meAvatarUrl}
				onLogout={p.onLogout}
				onOpenChatTab={onOpenChatTab}
				onOpenModule={onOpenModule as any}
				onRenameChat={handleRenameChat}
				onDeleteChat={handleDeleteChat}
			/>
		);
	}

	const [drawerAssets, setDrawerAssets] = useState<DrawerAsset[]>([]);
	const [projectAssets, setProjectAssets] = useState<ProjectAsset[]>([]);

	const workspaceLeftPx = isLgUp ? (desktopSidebarOpen ? 280 : 48) : 40;

	return (
		<TabManagerProvider>
			<WorldPlayerProvider>
			<SyncActiveChatFromTabs activeChatId={activeId} setActiveChatId={setActiveId} />
			<PrefetchChatMessagesFromTabs
				enabled={saveChatsEnabled}
				chatsHydrated={chatsHydrated}
				chats={chats}
				setChats={setChats}
			/>
			<NotificationBell />

			<div className="fixed inset-0 flex bg-neutral-950/10">
				{/* Desktop: a compact rail replaces the old full-width top navbar. */}
				{isLgUp && (
					<div
						className={`relative shrink-0 border-r border-neutral-200/15 dark:border-neutral-800 bg-neutral-950/35 backdrop-blur transition-[width] duration-200 ${
							desktopSidebarOpen ? "w-[280px]" : "w-12"
						}`}
					>
						<div className={`h-11 border-b border-neutral-200/10 dark:border-neutral-800 flex items-center ${desktopSidebarOpen ? "px-2 gap-2" : "justify-center"}`}>
							{desktopSidebarOpen ? (
								<>
									<img src="/ysong-logo-with-title.png" alt="YSong" className="dark:hidden h-6 w-auto object-contain object-left" />
									<img src="/ysong-logo-with-title-darkmode.png" alt="YSong" className="hidden dark:block h-6 w-auto object-contain object-left" />
								</>
							) : (
								<>
									<img src="/ysong-logo.png" alt="YSong" className="dark:hidden h-6 w-6 object-contain" />
									<img src="/ysong-logo-darkmode.png" alt="YSong" className="hidden dark:block h-6 w-6 object-contain" />
								</>
							)}
							<YSButton
								type="button"
								aria-label={desktopSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
								title={desktopSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
								onClick={() => setDesktopSidebarOpen((v) => !v)}
								className={`${desktopSidebarOpen ? "ml-auto" : "absolute top-12"} h-8 w-8 inline-flex items-center justify-center rounded-lg border bg-white/80 dark:bg-neutral-950/80 backdrop-blur`}
							>
								<span className="text-lg leading-none">{desktopSidebarOpen ? "‹" : "›"}</span>
							</YSButton>
						</div>
						{desktopSidebarOpen && (
							<div className="absolute inset-x-0 top-11 bottom-0 min-h-0 overflow-hidden">
								<SidebarWithTabsBridge
									meDisplayName={me?.displayName}
									meAvatarUrl={me?.avatarUrl}
									chats={chats}
									activeId={activeId}
									setActiveId={setActiveId}
									setChats={setChats}
									onLogout={logout}
								/>
							</div>
						)}
					</div>
				)}

				{/* Mobile/tablet: same pull-out rail concept as desktop; no hamburger. */}
				{!isLgUp && (
					<>
						<div className="relative z-[72] w-10 shrink-0 border-r border-neutral-200/15 dark:border-neutral-800 bg-neutral-950/35 backdrop-blur flex flex-col items-center">
							<img src="/ysong-logo.png" alt="YSong" className="dark:hidden mt-2 h-5 w-5 object-contain" />
							<img src="/ysong-logo-darkmode.png" alt="YSong" className="hidden dark:block mt-2 h-5 w-5 object-contain" />
							<YSButton
								type="button"
								aria-controls="mobile-sidebar"
								aria-expanded={mobileSidebarOpen}
								aria-label={mobileSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
								onClick={() => setMobileSidebarOpen((v) => !v)}
								className="mt-2 h-8 w-8 inline-flex items-center justify-center rounded-lg border bg-white/80 dark:bg-neutral-950/80"
							>
								<span className="text-lg leading-none">{mobileSidebarOpen ? "‹" : "›"}</span>
							</YSButton>
						</div>
						<MobileDrawer open={mobileSidebarOpen} onClose={() => setMobileSidebarOpen(false)}>
							<div className="h-11 px-3 border-b border-neutral-200/10 dark:border-neutral-800 flex items-center">
								<img src="/ysong-logo-with-title.png" alt="YSong" className="dark:hidden h-6 w-auto object-contain object-left" />
								<img src="/ysong-logo-with-title-darkmode.png" alt="YSong" className="hidden dark:block h-6 w-auto object-contain object-left" />
							</div>
							<SidebarWithTabsBridge
								meDisplayName={me?.displayName}
								meAvatarUrl={me?.avatarUrl}
								chats={chats}
								activeId={activeId}
								setActiveId={setActiveId}
								setChats={setChats}
								onLogout={logout}
								onNavigate={() => setMobileSidebarOpen(false)}
							/>
						</MobileDrawer>
					</>
				)}

				<PlayerAwareMain
					registry={registry}
					extraProps={{ chats, setChats, projectAssets, setProjectAssets, meAvatarUrl: me?.avatarUrl || "", meDisplayName: me?.displayName || "", meUserId: me?.id || "" }}
				/>
			</div>

			<WorkspaceBottomChrome
				chats={chats}
				setChats={setChats}
				drawerAssets={drawerAssets}
				setDrawerAssets={setDrawerAssets}
				activeChatId={activeId}
				projectAssets={projectAssets}
				setProjectAssets={setProjectAssets}
				workspaceLeftPx={workspaceLeftPx}
			/>

			<BootTabs
				me={me}
				chats={chats}
				chatsHydrated={chatsHydrated}
				onLayoutHydrated={() => setLayoutHydrated(true)}
			/>
			<SeedWorkspaceHistory ready={layoutHydrated} />
			<PersistLayout ready={layoutHydrated} />
			</WorldPlayerProvider>
		</TabManagerProvider>
	);

}



function EmptyWorkspaceHome({ extraProps }: { extraProps: Record<string, any> }) {
	const { openTab } = useTabManager();
	const crew = [
		{ name: "Surfer Dude", avatar: "/ai-personas/surfer-dude.png" },
		{ name: "Goth Girl", avatar: "/ai-personas/goth-girl.png" },
		{ name: "Pop Princess", avatar: "/ai-personas/pop-princess.png" },
	];

	const startChat = () => {
		const id = crypto.randomUUID();
		const newChat: Chat = { id, title: "", messages: [{ role: "assistant", text: YSONG_WELCOME }] as any[] };
		const setChats = extraProps.setChats as Dispatch<SetStateAction<Chat[]>> | undefined;
		setChats?.((current) => [newChat, ...current]);
		openTab({ type: "chat", title: "New Chat", payload: { chatId: id } });
	};

	const openModule = (type: Exclude<TabType, "chat">, title: string) => openTab({ type, title, pinned: true });

	return (
		<div className="flex-1 min-h-0 overflow-y-auto bg-gradient-to-b from-neutral-950/[.02] to-transparent dark:from-white/[.015]">
			<div className="mx-auto max-w-5xl px-6 py-12 md:py-16">
				<div className="max-w-2xl">
					<div className="text-[11px] uppercase tracking-[.24em] text-violet-500 mb-3">YSong</div>
					<h1 className="text-3xl md:text-4xl font-semibold tracking-tight">Welcome to your music workspace.</h1>
					<p className="mt-3 text-sm md:text-base opacity-60">Create music, collaborate in Rooms, chat with AI personas, or explore what other artists are making.</p>
				</div>

				<div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-8">
					<button onClick={startChat} className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-950/50 p-4 text-left hover:border-violet-500/60 hover:bg-violet-500/[.04] transition"><div className="text-sm font-semibold">Start a chat</div><div className="text-xs opacity-50 mt-1">Talk with a YSong AI persona.</div></button>
					<button onClick={()=>openModule("createSong","Create Song")} className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-950/50 p-4 text-left hover:border-violet-500/60 hover:bg-violet-500/[.04] transition"><div className="text-sm font-semibold">Create a song</div><div className="text-xs opacity-50 mt-1">Start from an idea and build a session.</div></button>
					<button onClick={()=>openModule("daw","DAW")} className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-950/50 p-4 text-left hover:border-violet-500/60 hover:bg-violet-500/[.04] transition"><div className="text-sm font-semibold">New project</div><div className="text-xs opacity-50 mt-1">Open the DAW and start from scratch.</div></button>
					<button onClick={()=>openModule("rooms","Rooms")} className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-950/50 p-4 text-left hover:border-violet-500/60 hover:bg-violet-500/[.04] transition"><div className="text-sm font-semibold">Open Rooms</div><div className="text-xs opacity-50 mt-1">Chat with humans and multiple AI personas.</div></button>
				</div>

				<div className="mt-10 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/45 dark:bg-neutral-950/35 p-5">
					<div className="flex items-center justify-between gap-4"><div><div className="text-sm font-semibold">Meet your AI crew</div><div className="text-xs opacity-50 mt-1">Start with the built-in personas, then create your own.</div></div><button onClick={()=>openModule("rooms","Rooms")} className="text-xs text-violet-500 hover:text-violet-400">Create a room</button></div>
					<div className="flex flex-wrap gap-3 mt-4">{crew.map((p)=><div key={p.name} className="flex items-center gap-2 rounded-xl border border-neutral-200 dark:border-neutral-800 px-3 py-2"><img src={p.avatar} alt="" className="h-9 w-9 rounded-full object-cover"/><span className="text-xs font-medium">{p.name}</span><span className="text-[9px] uppercase tracking-wide opacity-40">AI</span></div>)}</div>
				</div>
			</div>
		</div>
	);
}

function PlayerAwareMain({ registry, extraProps }: { registry: any; extraProps: Record<string, any> }) {
	const { current, playing } = useWorldPlayer();
	const { tabs, activeId } = useTabManager();
	const activeType = tabs.find((t) => t.id === activeId)?.type;
	const playerVisible = !!current && (activeType !== "daw" || playing);

	const hasActiveTab = !!activeId && tabs.some((t) => t.id === activeId);

	return (
		<main
			className={`flex-1 min-w-0 h-full min-h-0 flex flex-col transition-[padding-bottom] duration-150 ${playerVisible ? "pb-[124px] md:pb-[78px]" : "pb-0"}`}
		>
			<TabBar />
			{hasActiveTab ? <TabContentHost registry={registry} extraProps={extraProps} /> : <EmptyWorkspaceHome extraProps={extraProps} />}
		</main>
	);
}

function WorkspaceBottomChrome({
	chats, setChats, drawerAssets, setDrawerAssets, activeChatId, projectAssets, setProjectAssets, workspaceLeftPx,
}: {
	chats: Chat[];
	setChats: Dispatch<SetStateAction<Chat[]>>;
	drawerAssets: DrawerAsset[];
	setDrawerAssets: Dispatch<SetStateAction<DrawerAsset[]>>;
	activeChatId: string;
	projectAssets: ProjectAsset[];
	setProjectAssets: Dispatch<SetStateAction<ProjectAsset[]>>;
	workspaceLeftPx: number;
}) {
	const { tabs, activeId } = useTabManager();
	const { playing } = useWorldPlayer();
	const activeType = tabs.find((t) => t.id === activeId)?.type;
	const inDaw = activeType === "daw";
	const drawerContext = activeType === "chat" ? "chat" : activeType === "rooms" ? "room" : activeType === "daw" ? "daw" : null;
	const showDrawers = !!drawerContext;


	return (
		<>
			{showDrawers && (
				<BottomDrawers
					chats={chats}
					setChats={setChats}
					drawerAssets={drawerAssets}
					setDrawerAssets={setDrawerAssets}
					activeChatId={activeChatId}
					projectAssets={projectAssets}
					setProjectAssets={setProjectAssets}
					workspaceLeftPx={workspaceLeftPx}
					activeContext={drawerContext}
				/>
			)}
			<WorldPlayerDock hidden={inDaw && !playing} workspaceLeftPx={workspaceLeftPx} />
		</>
	);
}

/* --------------------------- mobile side drawer --------------------------- */

function MobileDrawer({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
	return (
		<div className={`lg:hidden fixed left-10 right-0 top-0 bottom-0 z-[70] ${open ? "" : "pointer-events-none"}`}>
			<div
				aria-hidden="true"
				className={`absolute inset-0 bg-black/45 transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0"}`}
				onClick={onClose}
			/>
			<div
				id="mobile-sidebar"
				role="dialog"
				aria-modal="true"
				aria-labelledby="mobile-sidebar-title"
				className={`absolute inset-y-0 left-0 w-[78%] max-w-[320px] bg-white dark:bg-neutral-950 shadow-2xl border-r border-neutral-200/15 dark:border-neutral-800 transition-transform duration-250 ${
					open ? "translate-x-0" : "-translate-x-full"
				}`}
			>
				<h2 id="mobile-sidebar-title" className="sr-only">Sidebar</h2>
				<div className="h-full min-h-0 overflow-y-auto">{children}</div>
			</div>
		</div>
	);
}
