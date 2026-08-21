// src/components/ProjectAssetDrawer.tsx
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import "../styles/asset-drawer.css";

import { YSButton } from "./YSButton";
import { FilePill, type FileKind } from "./FilePill";

const env = (import.meta as any).env || {};
const API_BASE = env.VITE_AUTH_API_URL || env.VITE_API_BASE_URL || "";
const API = (API_BASE || "").replace(/\/+$/, "");

async function uploadFileToCloud(file: File) {
	const token = localStorage.getItem("ys_token");
	if (!token) throw new Error("no_token");

	const form = new FormData();
	form.append("file", file);

	const base = API ? API + "/api/uploads" : "/api/uploads";
	const res = await fetch(base, {
		method: "POST",
		headers: { Authorization: `Bearer ${token}` },
		body: form,
	});

	if (!res.ok) throw new Error(`upload_failed_${res.status}`);
	return await res.json();
}

function shouldAttemptCopy() {
	try {
		if (localStorage.getItem("ysong:enableCopy") === "1") return true;

		const lower = String(API_BASE || "").toLowerCase();
		if (lower.includes("api.ysong.ai")) return false;

		if (API_BASE) {
			const u = new URL(API_BASE);
			if (u.hostname === "api.ysong.ai") return false;
		}
	} catch {}
	return true;
}

async function copyUploadIntoProject(objectKey: string, projectId: string) {
	if (!shouldAttemptCopy()) return objectKey;

	const token = localStorage.getItem("ys_token");
	if (!token) throw new Error("no_token");

	const base = API ? API + "/api/uploads/copy" : "/api/uploads/copy";
	const res = await fetch(base, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${token}`,
		},
		body: JSON.stringify({ objectKey, projectId }),
	});

	if (!res.ok) throw new Error(`copy_failed_${res.status}`);
	const data = await res.json();
	return String(data?.objectKey || data?.newObjectKey || "");
}
export type ProjectAsset = {
	id: string;
	kind: "audio";
	name: string;

	// Either local blob URL (imports) or a signed URL (runtime).
	url?: string;

	// Cloud object key for persisted assets.
	objectKey?: string;

	sizeMB?: number;
	durationSec?: number;
};

type Props = {
	projectAssets: ProjectAsset[];
	setProjectAssets: React.Dispatch<React.SetStateAction<ProjectAsset[]>>;
	onDeleteAsset?: (assetId: string) => void;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	hideHandle?: boolean;
	embedded?: boolean;
};

function makePillCloneGhost(pillEl: HTMLElement) {
	try {
		const clone = pillEl.cloneNode(true) as HTMLElement;
		clone.querySelectorAll("button, .fp-controls, .fp-more, .fp-toast-portal").forEach((n) => {
			try {
				(n as HTMLElement).remove();
			} catch {}
		});
		clone.style.position = "absolute";
		clone.style.top = "-1000px";
		clone.style.left = "-1000px";
		clone.style.pointerEvents = "none";
		clone.style.opacity = "0.72";
		clone.style.transform = "translateZ(0)";
		clone.style.filter = "drop-shadow(0 10px 22px rgba(0,0,0,0.35))";
		document.body.appendChild(clone);
		return clone;
	} catch {
		return null;
	}
}

export default function ProjectAssetDrawer(props: Props) {
	const {
		projectAssets,
		setProjectAssets,
		onDeleteAsset,
		open: controlledOpen,
		onOpenChange,
		hideHandle = false,
		embedded = false,
	} = props;

	const [openUncontrolled, setOpenUncontrolled] = useState(false);
	const isControlled = typeof controlledOpen === "boolean";
	const open = isControlled ? controlledOpen : openUncontrolled;
	const setOpen = (next: boolean | ((prev: boolean) => boolean)) => {
		const value = typeof next === "function" ? next(open) : next;
		if (isControlled) onOpenChange?.(value);
		else setOpenUncontrolled(value);
	};

	useEffect(() => {
		try {
			(window as any).__ysongProjectAssets = projectAssets;
			(window as any).__ysongSetProjectAssets = setProjectAssets;
		} catch {}
	}, [projectAssets, setProjectAssets]);

	const handleRef = useRef<HTMLButtonElement | null>(null);
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const triggerPicker = () => {
		setOpen(true);
		fileInputRef.current?.click();
	};

	const onPickFiles = async (e: ChangeEvent<HTMLInputElement>) => {
		const files = Array.from(e.target.files ?? []);
		e.currentTarget.value = "";
		if (!files.length) return;

		const projectId = (() => {
			try {
				return localStorage.getItem("ysong:activeProjectId") || "default";
			} catch {
				return "default";
			}
		})();

		const next: ProjectAsset[] = [];

		for (const f of files.filter((f) => (f.type || "").toLowerCase().startsWith("audio/"))) {
			try {
				const uploaded = await uploadFileToCloud(f);
				const srcKey = String(uploaded?.objectKey || "");

				let finalKey = srcKey;
				try {
					if (srcKey) {
						finalKey = (await copyUploadIntoProject(srcKey, projectId)) || srcKey;
					}
				} catch {
					// copy can fail in environments without /api/uploads/copy
					finalKey = srcKey;
				}

				next.push({
					id: finalKey || crypto.randomUUID(),
					kind: "audio",
					name: f.name,
					objectKey: finalKey || undefined,
					url: undefined,
					sizeMB: f.size / (1024 * 1024),
				});
			} catch {
				// true fallback only if upload itself failed
				next.push({
					id: crypto.randomUUID(),
					kind: "audio",
					name: f.name,
					url: URL.createObjectURL(f),
					objectKey: undefined,
					sizeMB: f.size / (1024 * 1024),
				});
			}
		}

		if (!next.length) return;

		setProjectAssets((prev) => [...prev, ...next]);
		setOpen(true);
	};

	const fileKind: FileKind = "audio";
	const sorted = useMemo(() => [...projectAssets], [projectAssets]);

	const panel = (
		<div
			id="project-asset-drawer-panel"
			className={`asset-drawer-panel ${open ? "asset-drawer-panel-open" : "asset-drawer-panel-closed"}`}
		>
			<div className="asset-drawer-header">
				<div className="asset-drawer-title">
					PROJECT ASSETS ({sorted.length})<span className="asset-drawer-hint">Drag onto an audio lane</span>
				</div>
				<div className="asset-drawer-actions">
					<YSButton
						type="button"
						className="asset-drawer-add-btn"
						onClick={triggerPicker}
						title="Import audio"
					>
						+
					</YSButton>
					<YSButton type="button" onClick={() => setOpen(false)} className="asset-drawer-close-btn">
						Close
					</YSButton>
				</div>
				<input
					ref={fileInputRef}
					type="file"
					multiple
					className="hidden"
					onChange={onPickFiles}
					accept="audio/*"
				/>
			</div>

			<div className="asset-drawer-scroll">
				<div className="asset-drawer-inner">
					{sorted.length === 0 ? (
						<div className="text-[12px] opacity-60 p-2">
							No project assets yet. Drop audio into the DAW or click +.
						</div>
					) : (
						<div className="asset-pill-grid">
							{sorted.map((a) => {
								const payload = {
									id: a.id,
									kind: "audio",
									name: a.name,
									url: a.url,
									objectKey: a.objectKey,
									durationSec: a.durationSec,
								};
								return (
									<div
										key={a.id}
										draggable={a.kind === "audio"}
										onDragStart={(e) => {
											e.dataTransfer.effectAllowed = "copy";
											e.dataTransfer.setData(
												"application/x-ysong-asset",
												JSON.stringify(payload),
											);
											e.dataTransfer.setData("text/plain", "");
											const pill = (e.currentTarget as HTMLElement).querySelector(
												".asset-pill",
											) as HTMLElement | null;
											const ghost = pill ? makePillCloneGhost(pill) : null;
											if (ghost) {
												const rect = ghost.getBoundingClientRect();
												e.dataTransfer.setDragImage(
													ghost,
													Math.min(28, rect.width / 2),
													Math.min(18, rect.height / 2),
												);
												setTimeout(() => {
													try {
														ghost.remove();
													} catch {}
												}, 600);
											}
										}}
										title={`Drag: ${a.name}`}
									>
										<FilePill
											id={a.id}
											name={a.name}
											sizeMB={Number.isFinite(a.sizeMB as number) ? (a.sizeMB as number) : 0}
											type={fileKind as any}
											publicUrl={a.url}
											objectKey={a.objectKey}
											disableScrub
											style={{ boxShadow: "0 14px 30px rgba(0,0,0,0.30)" }}
											onDelete={onDeleteAsset ? () => onDeleteAsset(a.id) : undefined}
										/>
									</div>
								);
							})}
						</div>
					)}
				</div>
			</div>
		</div>
	);

	if (!embedded) {
		return (
			<div className="asset-drawer-shell">
				<div className="asset-drawer-container">
					{!hideHandle && (
						<YSButton
							ref={handleRef}
							type="button"
							onClick={() => setOpen((v) => !v)}
							className="asset-drawer-handle"
							aria-expanded={open}
							aria-controls="project-asset-drawer-panel"
						>
							/=====\
						</YSButton>
					)}
					{panel}
				</div>
			</div>
		);
	}

	return panel;
}
