/**
 * YSong local/LAN device synchronization.
 *
 * - BroadcastChannel keeps the desktop/mobile/tablet cockpit windows in sync.
 * - Server-Sent Events relay persisted changes to real phones/tablets on the
 *   same Wi-Fi when they open the desktop's LAN URL.
 * - Selected YSong localStorage state is mirrored through /api/client-state so
 *   DAW/project state can follow an authenticated user to another device.
 * - Login/signup pages never refresh. The window that made a change ignores
 *   its own server event.
 */

const CHANNEL_NAME = "ysong-device-sync-v2";
const WINDOW_ID_KEY = "ysong:deviceSync:windowId";
const SUPPRESS_UNTIL_KEY = "ysong:deviceSync:suppressUntil";
const REMOTE_RELOAD_DELAY_MS = 650;
const RELOAD_SUPPRESSION_MS = 4000;
const BOOT_GRACE_MS = 2500;
const USER_ACTION_WINDOW_MS = 5000;

const bootedAt = Date.now();
let channel: BroadcastChannel | null = null;
let eventSource: EventSource | null = null;
let reloadTimer: number | null = null;
let outboundTimer: number | null = null;
let pendingReason = "state-change";
let installed = false;
let lastUserActionAt = 0;
let lastUserActionReason = "user-action";
let userActionGeneration = 0;
let pendingActionGeneration = 0;
const statePushTimers = new Map<string, number>();

function markUserAction(reason: string) {
	lastUserActionAt = Date.now();
	lastUserActionReason = reason || "user-action";
	userActionGeneration += 1;
	pendingActionGeneration = userActionGeneration;
}

function hasRecentUserAction(): boolean {
	return Date.now() - lastUserActionAt <= USER_ACTION_WINDOW_MS;
}

function recentUserActionReason(fallback = "user-action"): string {
	return hasRecentUserAction() ? lastUserActionReason : fallback;
}

function getDevDevice(): string {
	try {
		return new URLSearchParams(window.location.search).get("devDevice") || "";
	} catch {
		return "";
	}
}

function isAppPage(): boolean {
	return window.location.pathname.startsWith("/app");
}

function readToken(): string | null {
	try {
		return localStorage.getItem("ys_token") || localStorage.getItem("ysong_auth_token");
	} catch {
		return null;
	}
}

function readUidFromToken(): string | null {
	const token = readToken();
	if (!token) return null;
	try {
		const raw = token.split(".")[1] || "";
		const normalized = raw.replace(/-/g, "+").replace(/_/g, "/");
		const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
		const payload = JSON.parse(atob(padded));
		return String(payload?.uid ?? payload?.sub ?? payload?.userId ?? "") || null;
	} catch {
		return null;
	}
}

function getWindowId(): string {
	try {
		let id = sessionStorage.getItem(WINDOW_ID_KEY);
		if (!id) {
			id = crypto.randomUUID();
			sessionStorage.setItem(WINDOW_ID_KEY, id);
		}
		return id;
	} catch {
		return `${getDevDevice() || "device"}-${Math.random().toString(36).slice(2)}`;
	}
}

const windowId = typeof window !== "undefined" ? getWindowId() : "server";

function suppressUntil(): number {
	try {
		return Number(sessionStorage.getItem(SUPPRESS_UNTIL_KEY) || "0") || 0;
	} catch {
		return 0;
	}
}

function setSuppressedFor(ms: number) {
	try {
		sessionStorage.setItem(SUPPRESS_UNTIL_KEY, String(Date.now() + ms));
	} catch {}
}

function isSuppressed(): boolean {
	return Date.now() < suppressUntil();
}

function canParticipate(): boolean {
	// Deliberately require the authenticated app route. Login/signup windows stay
	// completely untouched until the user successfully signs in.
	return isAppPage() && !!readToken();
}

function getChannel(): BroadcastChannel | null {
	if (typeof BroadcastChannel === "undefined") return null;
	if (!channel) channel = new BroadcastChannel(CHANNEL_NAME);
	return channel;
}

function devLog(message: string, ...rest: unknown[]) {
	console.info(`[YSong Sync:${getDevDevice() || "device"}] ${message}`, ...rest);
}

function stableStorageValue(key: string, raw: string | null): string | null {
	if (raw == null) return null;
	try {
		// DAW transport/selection are LOCAL workflow state, not musical project data.
		// Mirroring them through /api/client-state lets a stale server snapshot replace
		// the desktop's selected instrument during cold boot, which in turn leaves the
		// native hardware-MIDI route null even though the VST itself loaded correctly.
		// Keep these fields out of cross-device comparison + server mirroring entirely.
		if (key.startsWith("ysong:daw:")) {
			const value = JSON.parse(raw);
			if (value && typeof value === "object") {
				delete value.playheadPosBars;
				delete value.selectedTrackId;
				delete value.selectedClipId;
				return JSON.stringify(value);
			}
		}
		// Project metadata updates timestamps during autosave; compare only the
		// meaningful project identity fields for sync purposes.
		if (key === "ysong:projects:v1") {
			const value = JSON.parse(raw);
			if (Array.isArray(value)) {
				return JSON.stringify(value.map((p) => ({ id: p?.id, name: p?.name })));
			}
		}
	} catch {
		// Non-JSON values are compared/persisted as-is.
	}
	return raw;
}

function mergeRemoteStateWithLocalWorkflow(key: string, localRaw: string | null, remoteRaw: string): string {
	if (!key.startsWith("ysong:daw:") || localRaw == null) return remoteRaw;
	try {
		const localValue = JSON.parse(localRaw);
		const remoteValue = JSON.parse(remoteRaw);
		if (!localValue || typeof localValue !== "object" || !remoteValue || typeof remoteValue !== "object") return remoteRaw;

		// Project/music data may come from another authenticated YSong device, but
		// selection and transport position belong to THIS window/device. Preserve them
		// whenever a remote DAW snapshot is applied so server hydration cannot silently
		// move live MIDI from an instrument track to Audio 1 during startup.
		if (Object.prototype.hasOwnProperty.call(localValue, "selectedTrackId"))
			remoteValue.selectedTrackId = localValue.selectedTrackId;
		if (Object.prototype.hasOwnProperty.call(localValue, "selectedClipId"))
			remoteValue.selectedClipId = localValue.selectedClipId;
		if (Object.prototype.hasOwnProperty.call(localValue, "playheadPosBars"))
			remoteValue.playheadPosBars = localValue.playheadPosBars;
		return JSON.stringify(remoteValue);
	} catch {
		return remoteRaw;
	}
}

function isYSongStateKey(key: string): boolean {
	if (!key) return false;
	if (key === "ys_token" || key === "ysong_auth_token") return false;
	if (key.startsWith("ysong.tos.")) return false;
	if (key.startsWith("ysong:deviceSync:") || key.startsWith("ysong:devSync:")) return false;
	return key.startsWith("ysong:") || key.startsWith("ysong.");
}

async function fetchClientState(): Promise<Record<string, string>> {
	const token = readToken();
	if (!token || !isAppPage()) return {};
	const res = await fetch("/api/client-state", {
		headers: { Authorization: `Bearer ${token}` },
		credentials: "include",
	});
	if (!res.ok) return {};
	const data = (await res.json().catch(() => ({}))) as { state?: Record<string, unknown> };
	const raw = data?.state && typeof data.state === "object" ? data.state : {};
	const state: Record<string, string> = {};
	for (const [key, value] of Object.entries(raw)) {
		if (typeof value === "string" && isYSongStateKey(key)) state[key] = value;
	}
	return state;
}

async function pushClientState(key: string, raw: string | null, remove = false) {
	if (!canParticipate() || isSuppressed() || !isYSongStateKey(key)) return;
	const token = readToken();
	if (!token) return;
	const value = stableStorageValue(key, raw);
	if (!remove && value == null) return;
	try {
		await fetch("/api/client-state", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
				"X-YSong-Client-Id": windowId,
			},
			credentials: "include",
			body: JSON.stringify(remove ? { key, remove: true } : { key, value }),
		});
	} catch (err) {
		devLog(`could not mirror ${key} to local API`, err);
	}
}

function queueClientStatePush(key: string, raw: string | null, remove = false) {
	const existing = statePushTimers.get(key);
	if (existing != null) window.clearTimeout(existing);
	const timer = window.setTimeout(() => {
		statePushTimers.delete(key);
		void pushClientState(key, raw, remove);
	}, 450);
	statePushTimers.set(key, timer);
}

async function hydrateClientStateFromServer(seedMissingLocalKeys: boolean): Promise<boolean> {
	if (!canParticipate()) return false;
	try {
		const remote = await fetchClientState();
		let changed = false;
		setSuppressedFor(RELOAD_SUPPRESSION_MS);

		for (const [key, remoteValue] of Object.entries(remote)) {
			if (!isYSongStateKey(key)) continue;
			const localValue = localStorage.getItem(key);
			const mergedValue = mergeRemoteStateWithLocalWorkflow(key, localValue, remoteValue);
			if (stableStorageValue(key, localValue) !== stableStorageValue(key, mergedValue)) {
				localStorage.setItem(key, mergedValue);
				changed = true;
			}
		}

		if (seedMissingLocalKeys) {
			for (let i = 0; i < localStorage.length; i++) {
				const key = localStorage.key(i) || "";
				if (!isYSongStateKey(key) || Object.prototype.hasOwnProperty.call(remote, key)) continue;
				const value = localStorage.getItem(key);
				if (value != null) void pushClientStateAfterSuppression(key, value);
			}
		}
		return changed;
	} catch (err) {
		devLog("client-state hydration failed", err);
		return false;
	}
}

async function pushClientStateAfterSuppression(key: string, value: string) {
	// Seeding is intentional during boot; bypass the short suppression window but
	// still require an authenticated /app session.
	const token = readToken();
	if (!token || !isAppPage()) return;
	const stable = stableStorageValue(key, value);
	if (stable == null) return;
	try {
		await fetch("/api/client-state", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
				"X-YSong-Client-Id": windowId,
			},
			credentials: "include",
			body: JSON.stringify({ key, value: stable }),
		});
	} catch {}
}

export function notifyRemoteWindows(reason = "state-change") {
	if (!canParticipate() || isSuppressed()) return;
	if (Date.now() - bootedAt < BOOT_GRACE_MS) return;
	if (!hasRecentUserAction()) return;

	pendingReason = reason;
	const actionGenerationAtSchedule = pendingActionGeneration;
	if (outboundTimer !== null) window.clearTimeout(outboundTimer);
	outboundTimer = window.setTimeout(() => {
		outboundTimer = null;
		if (!canParticipate() || isSuppressed()) return;
		if (!hasRecentUserAction()) return;
		if (actionGenerationAtSchedule !== pendingActionGeneration) {
			// A newer user action occurred while persistence was still settling.
			// The newer mutation will schedule its own broadcast.
			return;
		}

		const message = {
			type: "ysong-state-changed",
			sourceId: windowId,
			device: getDevDevice(),
			uid: readUidFromToken(),
			reason: pendingReason,
			ts: Date.now(),
		};

		const ch = getChannel();
		if (ch) ch.postMessage(message);

		const token = readToken();
		if (token) {
			void fetch("/api/sync/action", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${token}`,
					"X-YSong-Client-Id": windowId,
				},
				credentials: "include",
				body: JSON.stringify({ reason: pendingReason, sourceId: windowId }),
			}).catch(() => {});
		}

		// Consume this user action only after all debounced persistence has gone
		// quiet and a single cross-device event has actually been emitted.
		lastUserActionAt = 0;
		pendingActionGeneration = 0;
		devLog(`broadcasting ${message.reason}`);
	}, 850);
}

function scheduleRemoteReload(message: any) {
	if (!canParticipate() || isSuppressed()) return;
	if (!message || message.type !== "ysong-state-changed") return;
	if (message.sourceId && message.sourceId === windowId) return;

	const myUid = readUidFromToken();
	if (message.uid && myUid && String(message.uid) !== String(myUid)) return;

	if (reloadTimer !== null) window.clearTimeout(reloadTimer);
	reloadTimer = window.setTimeout(() => {
		reloadTimer = null;
		if (!canParticipate()) return;
		void (async () => {
			await hydrateClientStateFromServer(false);
			setSuppressedFor(RELOAD_SUPPRESSION_MS);
			devLog(`refreshing because another device changed ${message.reason || "state"}`);
			window.location.reload();
		})();
	}, REMOTE_RELOAD_DELAY_MS);
}

function installLocalStorageHooks() {
	const proto = Storage.prototype;
	const originalSetItem = proto.setItem;
	const originalRemoveItem = proto.removeItem;
	const originalClear = proto.clear;

	proto.setItem = function (key: string, value: string) {
		let before: string | null = null;
		let local = false;
		try {
			local = this === window.localStorage;
			if (local && isYSongStateKey(String(key))) before = this.getItem(key);
		} catch {}

		originalSetItem.call(this, key, value);

		if (local && isYSongStateKey(String(key)) && !isSuppressed()) {
			const oldStable = stableStorageValue(String(key), before);
			const newStable = stableStorageValue(String(key), String(value));
			if (oldStable !== newStable) {
				// Mirror state continuously, but refresh peers only when this write
				// belongs to a recent real user gesture. Autosaves stay silent.
				queueClientStatePush(String(key), String(value));
				if (hasRecentUserAction()) {
					notifyRemoteWindows(`${recentUserActionReason()}:local:${key}`);
				}
			}
		}
	};

	proto.removeItem = function (key: string) {
		let before: string | null = null;
		let local = false;
		try {
			local = this === window.localStorage;
			if (local && isYSongStateKey(String(key))) before = this.getItem(key);
		} catch {}
		originalRemoveItem.call(this, key);
		if (local && before != null && isYSongStateKey(String(key)) && !isSuppressed()) {
			queueClientStatePush(String(key), null, true);
			if (hasRecentUserAction()) {
				notifyRemoteWindows(`${recentUserActionReason()}:local-remove:${key}`);
			}
		}
	};

	proto.clear = function () {
		let local = false;
		try {
			local = this === window.localStorage;
		} catch {}
		originalClear.call(this);
		if (local && !isSuppressed() && hasRecentUserAction()) {
			notifyRemoteWindows(`${recentUserActionReason()}:local-clear`);
		}
	};

	return () => {
		proto.setItem = originalSetItem;
		proto.removeItem = originalRemoveItem;
		proto.clear = originalClear;
	};
}

function mutationInfo(input: RequestInfo | URL, init?: RequestInit): { method: string; url: string; body: string } {
	let method = String(init?.method || "GET").toUpperCase();
	let url = "";
	let body = "";
	try {
		if (typeof input === "string") url = input;
		else if (input instanceof URL) url = input.toString();
		else {
			url = input.url;
			if (!init?.method) method = String(input.method || "GET").toUpperCase();
		}
		if (typeof init?.body === "string") body = init.body;
	} catch {}
	return { method, url, body };
}

function apiPathFromUrl(raw: string): string {
	try {
		return new URL(raw, window.location.origin).pathname;
	} catch {
		return raw;
	}
}

function installFetchHook() {
	const originalFetch = window.fetch.bind(window);
	window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const info = mutationInfo(input, init);
		const isMutation = ["POST", "PUT", "PATCH", "DELETE"].includes(info.method);
		let forwardedInit = init;
		if (isMutation && canParticipate()) {
			const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
			headers.set("X-YSong-Client-Id", windowId);
			forwardedInit = { ...(init || {}), headers };
		}

		const response = await originalFetch(input as any, forwardedInit);

		if (response.ok && isMutation) {
			const path = apiPathFromUrl(info.url);
			const syncInfrastructure = path === "/api/client-state" || path === "/api/sync/action";
			if (path.startsWith("/api/") && !syncInfrastructure && hasRecentUserAction()) {
				// Every successful mutation caused by the current user gesture is a
				// deterministic sync point. notifyRemoteWindows is debounced, so one
				// click that saves layout + state still emits only one peer refresh.
				notifyRemoteWindows(`${recentUserActionReason()}:api:${path}`);
			}
		}

		return response;
	}) as typeof window.fetch;

	return () => {
		window.fetch = originalFetch;
	};
}

function installUserActionHooks() {
	const onPointerUp = () => markUserAction("pointer");
	const onDrop = () => markUserAction("drop");
	const onChange = () => markUserAction("change");
	const onKey = (event: KeyboardEvent) => {
		if (event.key === "Enter" || event.key === "Delete" || event.key === "Backspace") {
			markUserAction(`key:${event.key}`);
		}
	};

	// Mark intent only. A peer refresh is emitted later, after a real storage/API
	// mutation succeeds. This prevents clicks that do nothing from refreshing
	// other devices and prevents refreshes from racing ahead of persistence.
	document.addEventListener("pointerup", onPointerUp, true);
	document.addEventListener("drop", onDrop, true);
	document.addEventListener("change", onChange, true);
	document.addEventListener("keydown", onKey, true);

	return () => {
		document.removeEventListener("pointerup", onPointerUp, true);
		document.removeEventListener("drop", onDrop, true);
		document.removeEventListener("change", onChange, true);
		document.removeEventListener("keydown", onKey, true);
	};
}

function connectServerEvents() {
	if (!canParticipate() || typeof EventSource === "undefined") return;
	const token = readToken();
	if (!token) return;
	try {
		const qs = new URLSearchParams({ token, clientId: windowId });
		eventSource = new EventSource(`/api/sync/events?${qs.toString()}`);
		eventSource.onmessage = (event) => {
			try {
				const message = JSON.parse(event.data);
				if (message?.type === "ysong-sync-ready") return;
				scheduleRemoteReload(message);
			} catch {}
		};
		eventSource.onerror = () => {
			// EventSource reconnects automatically. Avoid noisy console errors.
		};
		devLog("LAN realtime channel connected");
	} catch (err) {
		devLog("LAN realtime channel unavailable", err);
	}
}

export function installDevCrossWindowSync() {
	if (installed) return;
	installed = true;

	const ch = getChannel();
	if (ch) ch.addEventListener("message", (event) => scheduleRemoteReload(event.data));
	installUserActionHooks();
	installLocalStorageHooks();
	installFetchHook();

	if (canParticipate()) {
		void (async () => {
			const changed = await hydrateClientStateFromServer(true);
			if (changed && canParticipate()) {
				setSuppressedFor(RELOAD_SUPPRESSION_MS);
				window.location.reload();
				return;
			}
			connectServerEvents();
		})();
	}

	devLog("device sync armed; unauthenticated windows remain untouched");
}
