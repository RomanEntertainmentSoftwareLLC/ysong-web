import { useEffect, useRef, useState } from "react";
import { apiGet, apiPost } from "../lib/authApi";
import { useTabManager } from "../tabs/core";

type NotificationItem = {
	id: string;
	kind: string;
	entityType: string | null;
	entityId: string | null;
	title: string;
	body: string;
	href: string;
	createdAt: string;
	read: boolean;
};

type NotificationPayload = { notifications: NotificationItem[]; unreadCount: number };

export default function NotificationBell() {
	const { tabs, openTab, activateTab } = useTabManager();
	const [open, setOpen] = useState(false);
	const [items, setItems] = useState<NotificationItem[]>([]);
	const [unread, setUnread] = useState(0);
	const [emailEnabled, setEmailEnabled] = useState(false);
	const boxRef = useRef<HTMLDivElement>(null);

	const load = async () => {
		try {
			const data = await apiGet<NotificationPayload>("/api/notifications?limit=50");
			setItems(data.notifications || []); setUnread(data.unreadCount || 0);
		} catch {}
	};

	useEffect(() => {
		load();
		apiGet<{ emailEnabled: boolean }>("/api/notifications/preferences").then((x) => setEmailEnabled(!!x.emailEnabled)).catch(() => {});
		const timer = window.setInterval(load, 30_000);
		const changed = () => load();
		window.addEventListener("ysong:notifications-changed", changed);
		return () => { window.clearInterval(timer); window.removeEventListener("ysong:notifications-changed", changed); };
	}, []);

	useEffect(() => {
		const onPointer = (e: PointerEvent) => { if (open && boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
		window.addEventListener("pointerdown", onPointer);
		return () => window.removeEventListener("pointerdown", onPointer);
	}, [open]);

	const markAll = async () => {
		await apiPost("/api/notifications/read", {});
		setItems((prev) => prev.map((n) => ({ ...n, read: true }))); setUnread(0);
	};

	const openModule = (type: "world" | "achievements", title: string) => {
		const existing = tabs.find((t) => t.type === type);
		if (existing) activateTab(existing.id);
		else openTab({ type, title, pinned: true });
	};

	const openNotification = async (n: NotificationItem) => {
		if (!n.read) {
			apiPost("/api/notifications/read", { id: n.id }).catch(() => {});
			setItems((prev) => prev.map((x) => x.id === n.id ? { ...x, read: true } : x));
			setUnread((v) => Math.max(0, v - 1));
		}
		setOpen(false);
		if (n.entityType === "achievement") { openModule("achievements", "Achievements"); return; }
		if (["track", "release", "playlist", "artist"].includes(String(n.entityType))) {
			openModule("world", "YSong World");
			if (n.entityId && n.entityType !== "artist") setTimeout(() => window.dispatchEvent(new CustomEvent("ysong:open-world-entity", { detail: { entityType: n.entityType, entityId: n.entityId } })), 50);
			return;
		}
		openModule("world", "YSong World");
	};

	const toggleEmail = async () => {
		const next = !emailEnabled;
		setEmailEnabled(next);
		try { await apiPost("/api/notifications/preferences", { emailEnabled: next }); }
		catch { setEmailEnabled(!next); }
	};

	return <div ref={boxRef} className="fixed top-1.5 right-2 z-[86] text-neutral-100">
		<button type="button" onClick={() => { setOpen((v) => !v); if (!open) load(); }} className="relative h-9 w-9 rounded-xl border border-neutral-700 bg-neutral-950/90 backdrop-blur grid place-items-center hover:bg-neutral-900 shadow-lg" aria-label="Notifications" title="Notifications">
			<span aria-hidden="true">🔔</span>
			{unread > 0 && <span className="absolute -right-1.5 -top-1.5 min-w-5 h-5 px-1 rounded-full bg-indigo-500 border-2 border-neutral-950 text-[10px] font-bold grid place-items-center">{unread > 99 ? "99+" : unread}</span>}
		</button>
		{open && <div className="absolute right-0 mt-2 w-[min(92vw,390px)] max-h-[72vh] overflow-hidden rounded-2xl border border-neutral-700 bg-neutral-950 shadow-2xl">
			<div className="flex items-center justify-between gap-3 p-3 border-b border-neutral-800"><div><div className="font-semibold">Notifications</div><div className="text-[11px] text-neutral-500">{unread ? `${unread} unread` : "You're caught up"}</div></div><button onClick={markAll} className="text-xs text-indigo-300 hover:text-indigo-200">Mark all read</button></div>
			<div className="max-h-[52vh] overflow-y-auto">
				{items.length === 0 && <div className="p-8 text-center text-neutral-500 text-sm"><div className="text-3xl mb-2">🔕</div>No notifications yet.</div>}
				{items.map((n) => <button key={n.id} onClick={() => openNotification(n)} className={`w-full text-left p-3 border-b last:border-0 border-neutral-800 hover:bg-neutral-900/80 ${n.read ? "opacity-65" : "bg-indigo-500/5"}`}><div className="flex gap-2"><div className={`mt-1 h-2 w-2 rounded-full shrink-0 ${n.read ? "bg-neutral-700" : "bg-indigo-400"}`} /><div className="min-w-0"><div className="text-sm font-medium">{n.title}</div>{n.body && <div className="text-xs text-neutral-400 mt-0.5 line-clamp-2">{n.body}</div>}<div className="text-[10px] text-neutral-600 mt-1">{timeAgo(n.createdAt)}</div></div></div></button>)}
			</div>
			<div className="p-3 border-t border-neutral-800 bg-neutral-900/40 flex items-center justify-between gap-3"><div><div className="text-xs font-medium">Email social notifications</div><div className="text-[10px] text-neutral-500">Receive important YSong activity at your account email address.</div></div><button onClick={toggleEmail} className={`relative h-6 w-11 rounded-full transition ${emailEnabled ? "bg-indigo-500" : "bg-neutral-700"}`} aria-pressed={emailEnabled}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-transform ${emailEnabled ? "translate-x-6" : "translate-x-1"}`} /></button></div>
		</div>}
	</div>;
}

function timeAgo(value: string) {
	const diff = Math.max(0, Date.now() - new Date(value).getTime());
	const min = Math.floor(diff / 60_000);
	if (min < 1) return "Just now";
	if (min < 60) return `${min}m ago`;
	const hours = Math.floor(min / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return days < 7 ? `${days}d ago` : new Date(value).toLocaleDateString();
}
