import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import "../styles/asset-drawer.css";
import type { Chat } from "./UISidebar";
import { YSButton } from "./YSButton";
import { FilePill, type FileKind } from "./FilePill";
import { audioController, type AudioAsset } from "./AudioController";
import { appendMessage } from "../lib/chatApi";

const ZWSP = "\u200B";
const env = (import.meta as any).env || {};
const API_BASE = env.VITE_AUTH_API_URL || env.VITE_API_BASE_URL || "";
const API = (API_BASE || "").replace(/\/+$/, "");

type SignedUrlMode = "play" | "download";

async function fetchSignedUrl(objectKey: string, mode: SignedUrlMode = "play") {
	const token = localStorage.getItem("ys_token");
	if (!token) throw new Error("no_token");

	// Backend route: GET /api/uploads/signed-url?objectKey=...&mode=play|download
	const base = API ? API.replace(/\/+$/, "") + "/api/uploads/signed-url" : "/api/uploads/signed-url";
	const qs = new URLSearchParams({ objectKey, mode }).toString();

	const res = await fetch(`${base}?${qs}`, {
		method: "GET",
		headers: {
			Authorization: `Bearer ${token}`,
		},
	});

	if (!res.ok) throw new Error(`signed_url_failed_${res.status}`);

	const data = await res.json();

	const signed = typeof data?.url === "string" ? data.url : typeof data?.signedUrl === "string" ? data.signedUrl : "";

	const expiresAt =
		typeof data?.expiresAt === "number" && Number.isFinite(data.expiresAt)
			? data.expiresAt
			: Date.now() + 55 * 60 * 1000;

	if (!signed) throw new Error("signed_url_missing");

	return { url: signed, expiresAt };
}

const AUDIO_EXT = /\.(mp3|wav|flac|m4a|aac|ogg|opus|aiff|aif|caf|wma)$/i;

function isLikelySignedUrl(url?: string) {
	if (!url) return false;
	return /[?&]X-Goog-(Algorithm|Signature|Credential)=/i.test(url);
}

function needsSignedPlayUrl(url?: string) {
	if (!url) return true;
	if (isLikelySignedUrl(url)) return false;
	try {
		const u = new URL(url);
		if (u.hostname === "storage.googleapis.com") return true;
		if (u.hostname.endsWith(".storage.googleapis.com")) return true;
	} catch {
		return true;
	}
	return true;
}

function isAudioAttachment(a?: { name?: string; type?: string }) {
	if (!a) return false;

	const t = String(a.type || "").toLowerCase();
	if (t.startsWith("audio/")) return true;

	const name = String(a.name || "");
	return AUDIO_EXT.test(name);
}

// For immediate playback, we keep *signed* play URLs in local UI state.
// For Neon persistence, we strip signed URLs (they expire) and keep only objectKey + metadata.
async function withSignedPlayUrls(
	atts: Attachment[],
	cache: Map<string, { url: string; expiresAt: number }>
): Promise<Attachment[]> {
	if (!atts.length) return atts;

	const now = Date.now();

	return await Promise.all(
		atts.map(async (a) => {
			if (!isAudioAttachment(a) || !a.objectKey) return a;

			const cached = cache.get(a.objectKey);
			if (cached && cached.expiresAt > now + 60_000) {
				return { ...a, publicUrl: cached.url };
			}

			try {
				const s = await fetchSignedUrl(a.objectKey, "play");
				cache.set(a.objectKey, s);
				return { ...a, publicUrl: s.url };
			} catch {
				return a;
			}
		})
	);
}

function stripSignedUrlsForNeon(atts: Attachment[]): Attachment[] {
	return atts.map((a) => ({
		name: a.name,
		size: a.size,
		type: a.type,
		objectKey: a.objectKey,
	}));
}

/**
 * Asset records that can live in the drawer without needing a chat message.
 *
 * NOTES:
 *  - Chat uploads appear in the drawer (derived from chat message attachments).
 *  - Drawer uploads ALSO post an attachment message to the *active chat* (if provided),
 *    so the AI + prompt-audio controller can see/play them (same behavior as ChatPane [+]).
 */
export type DrawerAsset = {
	id: string;
	name: string;
	sizeMB: number;
	type: FileKind;
	publicUrl?: string;
	objectKey?: string;
	addedAt?: number;
};

type Props = {
	chats: Chat[];
	setChats: React.Dispatch<React.SetStateAction<Chat[]>>;
	drawerAssets: DrawerAsset[];
	setDrawerAssets: React.Dispatch<React.SetStateAction<DrawerAsset[]>>;
	activeChatId?: string;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	hideHandle?: boolean;
	embedded?: boolean;
};

type Attachment = {
	name: string;
	size: number;
	type: string;
	publicUrl?: string;
	objectKey?: string;
};

function fileKey(f: File) {
	return `${f.name}:${f.size}:${f.lastModified}`;
}

function fmtMB(bytes: number) {
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function uploadLabel(atts?: Attachment[]) {
	const list = Array.isArray(atts) ? atts : [];
	if (list.length === 0) return "Uploaded file(s).";

	if (list.length === 1) {
		const a = list[0];
		return `Uploaded: ${a.name} (${fmtMB(a.size)})`;
	}

	const names = list.map((a) => a.name).join(", ");
	return `Uploaded ${list.length} files: ${names}`;
}

function deriveObjectKeyFromPublicUrl(url?: string): string | undefined {
	if (!url) return;

	try {
		const u = new URL(url);

		// https://storage.googleapis.com/<bucket>/<objectKey>
		if (u.hostname === "storage.googleapis.com") {
			const parts = u.pathname.split("/").filter(Boolean);
			if (parts.length >= 2) {
				// drop bucket (parts[0]), keep the rest
				return decodeURIComponent(parts.slice(1).join("/"));
			}
		}

		// https://<bucket>.storage.googleapis.com/<objectKey>
		if (u.hostname.endsWith(".storage.googleapis.com")) {
			const key = u.pathname.replace(/^\/+/, "");
			return key ? decodeURIComponent(key) : undefined;
		}
	} catch {
		// ignore
	}

	return;
}

function normalizeAttachment(raw: any): Attachment {
	if (typeof raw === "string") {
		return { name: raw, size: 0, type: "" };
	}

	const name =
		typeof raw?.name === "string" ? raw.name : typeof raw?.filename === "string" ? raw.filename : "Unknown file";

	const size = typeof raw?.size === "number" ? raw.size : typeof raw?.bytes === "number" ? raw.bytes : 0;

	const type = typeof raw?.type === "string" ? raw.type : typeof raw?.contentType === "string" ? raw.contentType : "";

	// accept legacy keys too
	const publicUrl = raw?.publicUrl ?? raw?.public_url ?? raw?.url ?? raw?.publicURL ?? undefined;

	let objectKey = raw?.objectKey ?? raw?.object_key ?? raw?.gcsObjectKey ?? raw?.gcs_key ?? undefined;

	// if we only have the GCS url, derive objectKey from it
	if (!objectKey) objectKey = deriveObjectKeyFromPublicUrl(publicUrl);

	return { name, size, type, publicUrl, objectKey };
}

async function deleteUploadFromCloud(objectKey: string) {
	const token = localStorage.getItem("ys_token");
	if (!token) throw new Error("no_token");

	const url = API ? `${API}/api/uploads/delete` : `/api/uploads/delete`;

	const res = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${token}`,
		},
		body: JSON.stringify({ objectKey }),
	});

	if (!res.ok) throw new Error(`delete_failed_${res.status}`);
}

async function removeAttachmentFromMessage(messageId: string, objectKey: string) {
	const token = localStorage.getItem("ys_token");
	if (!token) return;

	const removeUrl = API ? `${API}/api/messages/remove-attachment` : `/api/messages/remove-attachment`;

	const res = await fetch(removeUrl, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${token}`,
		},
		body: JSON.stringify({ messageId, objectKey }),
	});

	if (!res.ok) {
		console.warn("remove-attachment failed", messageId, await res.text());
	}
}

export default function AssetDrawer(props: Props) {
	const {
		chats,
		setChats,
		drawerAssets,
		setDrawerAssets,
		activeChatId,
		hideHandle = false,
		embedded = false,
	} = props;
	const [openUncontrolled, setOpenUncontrolled] = useState(false);
	const isControlled = typeof props.open === "boolean";
	const open = isControlled ? props.open! : openUncontrolled;

	const setOpen = (next: boolean | ((prev: boolean) => boolean)) => {
		const value = typeof next === "function" ? next(open) : next;
		if (isControlled) props.onOpenChange?.(value);
		else setOpenUncontrolled(value);
	};

	const handleRef = useRef<HTMLButtonElement | null>(null);

	const fileInputRef = useRef<HTMLInputElement | null>(null);

	const signedUrlCacheRef = useRef<Map<string, { url: string; expiresAt: number }>>(new Map());

	const [isUploading, setIsUploading] = useState(false);
	const [progressByKey, setProgressByKey] = useState<Record<string, number>>({});

	const [signedPlayUrlByKey, setSignedPlayUrlByKey] = useState<Record<string, string>>({});

	// drag overlay (avoid flicker with counter)
	const [dragActive, setDragActive] = useState(false);
	const dragCounter = useRef(0);

	// Keep aria-expanded in sync with state
	useEffect(() => {
		if (handleRef.current) {
			handleRef.current.setAttribute("aria-expanded", open ? "true" : "false");
		}
	}, [open]);

	const overallPct = useMemo(() => {
		const vals = Object.values(progressByKey);
		if (!vals.length) return 0;
		return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
	}, [progressByKey]);

	const assets = useMemo(() => {
		const byId = new Map<string, DrawerAsset>();

		// 1) drawer-owned assets first
		for (const a of drawerAssets ?? []) {
			if (!a?.id) continue;
			byId.set(a.id, a);
		}

		// 2) chat-derived assets
		for (const c of chats) {
			for (const msg of c.messages ?? []) {
				const ts = Number((msg as any)?.ts ?? 0) || 0;
				const atts = (msg as any).attachments ?? [];
				if (!Array.isArray(atts) || atts.length === 0) continue;

				for (const raw of atts) {
					const a = normalizeAttachment(raw);
					// IMPORTANT: Keep IDs consistent with ChatPane so that
					// prompt-play (AudioController.currentId) correctly lights
					// up the matching FilePill in the drawer.
					//
					// When we don't have an objectKey/publicUrl (legacy/file-only
					// metadata), ChatPane uses "<messageId>:<name>" if a message
					// id exists.
					const msgId = String((msg as any)?.id ?? "").trim();
					const stableId =
						a.objectKey ?? a.publicUrl ?? (msgId ? `${msgId}:${a.name}` : `${a.name}:${a.size}`);

					const sizeMB = a.size ? Number((a.size / (1024 * 1024)).toFixed(1)) : 0;

					const kind: FileKind = a.type?.toLowerCase().startsWith("audio") ? "audio" : "file";

					const existing = byId.get(stableId);
					if (!existing) {
						byId.set(stableId, {
							id: stableId,
							name: a.name,
							sizeMB,
							type: kind,
							publicUrl: a.publicUrl,
							objectKey: a.objectKey,
							addedAt: ts,
						});
					} else {
						const nextAdded = Math.max(existing.addedAt ?? 0, ts);
						if (nextAdded !== (existing.addedAt ?? 0)) {
							byId.set(stableId, {
								...existing,
								addedAt: nextAdded,
							});
						}
					}
				}
			}
		}

		// Sort newest first
		return Array.from(byId.values()).sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0));
	}, [chats, drawerAssets]);

	// --- Signed URL prefetch (play) ---
	// Drawer + chat assets are in a private bucket, so FilePill needs a short-lived signed URL.
	useEffect(() => {
		let cancelled = false;

		const cache = signedUrlCacheRef.current;
		const now = Date.now();

		const audioNeedingUrl = assets.filter((a) => a.type === "audio" && !!a.objectKey).slice(0, 24);

		(async () => {
			for (const a of audioNeedingUrl) {
				const key = a.objectKey!;

				const existing = signedPlayUrlByKey[key];
				if (existing && !needsSignedPlayUrl(existing)) continue;

				const cached = cache.get(key);
				if (cached && cached.expiresAt > now + 60_000) {
					if (cancelled) return;
					setSignedPlayUrlByKey((prev) => (prev[key] === cached.url ? prev : { ...prev, [key]: cached.url }));
					continue;
				}

				try {
					const signed = await fetchSignedUrl(key, "play");
					if (cancelled) return;
					cache.set(key, signed);
					setSignedPlayUrlByKey((prev) => (prev[key] === signed.url ? prev : { ...prev, [key]: signed.url }));
				} catch {
					// ignore
				}
			}
		})();

		return () => {
			cancelled = true;
		};
		// intentionally not depending on signedPlayUrlByKey to avoid loops
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [assets]);

	// Keep AudioController in sync so prompt-play can target drawer assets too.
	useEffect(() => {
		const audioAssets: AudioAsset[] = assets
			.filter((a) => a.type === "audio")
			.map((a) => {
				const id = a.objectKey ?? a.publicUrl ?? a.id;
				const playableUrl = a.objectKey ? signedPlayUrlByKey[a.objectKey] ?? a.publicUrl : a.publicUrl;

				return {
					id,
					name: a.name,
					type: "audio",
					sizeMB: a.sizeMB ?? 0,
					publicUrl: playableUrl,
					objectKey: a.objectKey,
				} satisfies AudioAsset;
			});

		audioController.registerAssets(audioAssets);
	}, [assets, signedPlayUrlByKey]);

	async function uploadWithXHR(
		url: string,
		token: string,
		file: File,
		onProgress: (pct: number) => void
	): Promise<any> {
		return await new Promise((resolve, reject) => {
			const formData = new FormData();
			formData.append("file", file, file.name);

			const xhr = new XMLHttpRequest();
			xhr.open("POST", url, true);
			xhr.responseType = "json";
			xhr.setRequestHeader("Authorization", `Bearer ${token}`);

			xhr.upload.onprogress = (evt) => {
				if (!evt.lengthComputable) return;
				const pct = Math.max(0, Math.min(100, Math.round((evt.loaded / evt.total) * 100)));
				onProgress(pct);
			};

			xhr.onload = () => {
				if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response);
				else reject(new Error(`upload_failed_${xhr.status}`));
			};

			xhr.onerror = () => reject(new Error("upload_network_error"));
			xhr.send(formData);
		});
	}

	async function uploadFiles(files: File[]): Promise<Attachment[]> {
		if (files.length === 0) return [];

		const token = localStorage.getItem("ys_token");
		if (!token) throw new Error("no_token");

		const url = API ? `${API}/api/uploads` : `/api/uploads`;

		const uploaded: Attachment[] = [];

		for (const file of files) {
			const k = fileKey(file);

			const json = await uploadWithXHR(url, token, file, (pct) => {
				setProgressByKey((prev) => ({ ...prev, [k]: pct }));
			});

			setProgressByKey((prev) => ({ ...prev, [k]: 100 }));

			uploaded.push({
				name: json?.filename ?? file.name,
				size: json?.size ?? file.size,
				type: json?.contentType ?? file.type,
				publicUrl: json?.publicUrl,
				objectKey: json?.objectKey,
			});
		}

		return uploaded;
	}

	async function addAssetsToDrawer(files: File[]) {
		if (!files.length) return;

		// filter (same limit as ChatPane)
		const filtered = files.filter((f) => f.size <= 50 * 1024 * 1024);
		if (!filtered.length) return;

		setOpen(true);

		setProgressByKey((prev) => {
			const next = { ...prev };
			for (const f of filtered) next[fileKey(f)] = 0;
			return next;
		});

		setIsUploading(true);

		let uploaded: Attachment[] = [];
		try {
			uploaded = await uploadFiles(filtered);
		} catch (e) {
			console.error("AssetDrawer upload failed:", e);
			return;
		} finally {
			setIsUploading(false);
			setProgressByKey({});
			dragCounter.current = 0;
			setDragActive(false);
		}

		if (!uploaded.length) return;

		// Pre-warm signed PLAY URLs for local UI playback (do NOT persist them).
		const signedUploaded = await withSignedPlayUrls(uploaded, signedUrlCacheRef.current);

		// Cache signed urls for immediate FilePill playback in the drawer.
		setSignedPlayUrlByKey((prev) => {
			const next = { ...prev };
			for (const a of signedUploaded) {
				if (a.objectKey && a.publicUrl) next[a.objectKey] = a.publicUrl;
			}
			return next;
		});

		const uploadedPersist = stripSignedUrlsForNeon(signedUploaded);

		const now = Date.now();

		// Post to active chat (ChatPane [+] behavior)
		if (activeChatId) {
			// Capture the chat id at the moment the upload completes so we don't
			// accidentally write to a different chat if the user switches tabs.
			const targetChatId = activeChatId;
			const userTs = now;
			const attachments: Attachment[] = signedUploaded;

			// optimistic UI
			setChats((prev) =>
				prev.map((c) =>
					c.id === targetChatId
						? {
								...c,
								messages: [
									...(c.messages ?? []),
									{
										role: "user",
										text: uploadLabel(attachments),
										attachments,
										ts: userTs,
									} as any,
								],
						  }
						: c
				)
			);

			// persist to Neon (best-effort)
			appendMessage(targetChatId, {
				role: "user",
				content: ZWSP,
				attachments: uploadedPersist,
			})
				.then((saved: any) => {
					if (!saved?.id) return;

					setChats((prev) =>
						prev.map((c) =>
							c.id === targetChatId
								? {
										...c,
										messages: (c.messages ?? []).map((m: any) =>
											m.role === "user" && m.ts === userTs ? { ...m, id: saved.id } : m
										),
								  }
								: c
						)
					);
				})
				.catch((e: any) => console.error("AssetDrawer failed to persist upload message", e));
		}

		// Still add to drawer-owned state
		const next: DrawerAsset[] = uploadedPersist.map((u) => {
			const id = u.objectKey ?? u.publicUrl ?? `${u.name}:${u.size}`;
			const kind: FileKind = u.type?.toLowerCase().startsWith("audio") ? "audio" : "file";
			const sizeMB = u.size ? Number((u.size / (1024 * 1024)).toFixed(1)) : 0;
			return {
				id,
				name: u.name,
				sizeMB,
				type: kind,
				publicUrl: undefined,
				objectKey: u.objectKey,
				addedAt: now,
			};
		});

		setDrawerAssets((prev) => {
			const byId = new Map<string, DrawerAsset>();
			for (const a of prev ?? []) byId.set(a.id, a);
			for (const a of next) byId.set(a.id, a);
			return Array.from(byId.values()).sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0));
		});
	}

	async function deleteAssetEverywhere(objectKey: string) {
		if (!objectKey) return;

		// Snapshot which messages reference this objectKey (for server cleanup)
		const messageIds: string[] = [];
		for (const c of chats) {
			for (const msg of c.messages ?? []) {
				const mid = (msg as any).id as string | undefined;
				const atts = (msg as any).attachments ?? [];
				if (!mid || !Array.isArray(atts)) continue;

				if (atts.some((raw: any) => normalizeAttachment(raw).objectKey === objectKey)) {
					messageIds.push(mid);
				}
			}
		}

		try {
			await deleteUploadFromCloud(objectKey);
		} catch (e) {
			console.error("Delete from cloud failed", e);
		}

		await Promise.all(messageIds.map((mid) => removeAttachmentFromMessage(mid, objectKey)));

		setChats((prev) =>
			prev.map((c) => ({
				...c,
				messages: (c.messages ?? []).map((msg: any) => {
					const atts = msg.attachments ?? [];
					if (!Array.isArray(atts) || atts.length === 0) return msg;

					const nextAtt = atts.filter((raw: any) => normalizeAttachment(raw).objectKey !== objectKey);

					if (nextAtt.length === atts.length) return msg;

					return {
						...msg,
						attachments: nextAtt.length ? nextAtt : undefined,
					};
				}),
			}))
		);

		setDrawerAssets((prev) => (prev ?? []).filter((a) => a.objectKey !== objectKey));
	}

	function triggerPicker() {
		setOpen(true);
		fileInputRef.current?.click();
	}

	function onPickFiles(e: ChangeEvent<HTMLInputElement>) {
		const files = Array.from(e.target.files ?? []);
		e.currentTarget.value = "";
		if (!files.length) return;
		void addAssetsToDrawer(files);
	}

	function onDragEnter(e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();
		dragCounter.current += 1;
		setDragActive(true);
	}

	function onDragLeave(e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();
		dragCounter.current -= 1;
		if (dragCounter.current <= 0) {
			dragCounter.current = 0;
			setDragActive(false);
		}
	}

	function onDragOver(e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();

		dragCounter.current = 0;
		setDragActive(false);

		const files = Array.from(e.dataTransfer?.files ?? []);
		if (!files.length) return;

		void addAssetsToDrawer(files);
	}

	const panel = (
		<div
			id="asset-drawer-panel"
			className={`asset-drawer-panel ${open ? "asset-drawer-panel-open" : "asset-drawer-panel-closed"}`}
		>
			{/* header */}
			<div className="asset-drawer-header">
				<div className="asset-drawer-title">
					{isUploading ? `UPLOADING… ${overallPct}%` : `ASSETS (${assets.length})`}
					<span className="asset-drawer-hint">Drop files here or click +</span>
				</div>

				<div className="asset-drawer-actions">
					<YSButton
						type="button"
						className="asset-drawer-add-btn"
						onClick={triggerPicker}
						disabled={isUploading}
						title="Add files"
					>
						+
					</YSButton>

					<YSButton
						type="button"
						onClick={() => setOpen(false)}
						className="asset-drawer-close-btn"
						disabled={isUploading}
					>
						Close
					</YSButton>
				</div>

				<input
					ref={fileInputRef}
					type="file"
					multiple
					className="hidden"
					onChange={onPickFiles}
					accept="audio/*,image/*,.txt,.md,.lrc,.lyr,.rtf,.json"
				/>
			</div>

			{/* scrollable content + dropzone */}
			<div
				className="asset-drawer-scroll asset-drawer-dropzone"
				onDragEnter={onDragEnter}
				onDragLeave={onDragLeave}
				onDragOver={onDragOver}
				onDrop={onDrop}
			>
				{(dragActive || isUploading) && (
					<div className="asset-drawer-dropoverlay">
						<div className="asset-drawer-dropcard">
							<div className="asset-drawer-dropcard-title">Drop to upload</div>
							<div className="asset-drawer-dropcard-sub">
								Files will be added to your current chat and appear here instantly.
							</div>
						</div>
					</div>
				)}

				<div className="asset-drawer-inner">
					<div className="asset-pill-grid">
						{assets.map((asset) => (
							<FilePill
								key={asset.id}
								id={asset.id}
								name={asset.name}
								sizeMB={asset.sizeMB}
								type={asset.type as any}
								publicUrl={
									asset.objectKey
										? signedPlayUrlByKey[asset.objectKey] ?? asset.publicUrl
										: asset.publicUrl
								}
								objectKey={asset.objectKey}
								onDelete={asset.objectKey ? () => deleteAssetEverywhere(asset.objectKey!) : undefined}
							/>
						))}
					</div>
				</div>
			</div>
		</div>
	);

	if (embedded) return panel;

	return (
		<div className="asset-drawer-shell">
			<div className="asset-drawer-container">
				{!hideHandle && (
					<YSButton
						ref={handleRef}
						type="button"
						onClick={() => setOpen((v) => !v)}
						className="asset-drawer-handle"
						aria-expanded="false"
						aria-controls="asset-drawer-panel"
					>
						/=====\
					</YSButton>
				)}

				{panel}
			</div>
		</div>
	);
}
