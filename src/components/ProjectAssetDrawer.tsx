// src/components/ProjectAssetDrawer.tsx
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import "../styles/asset-drawer.css";

import { YSButton } from "./YSButton";
import { FilePill, type FileKind } from "./FilePill";
import type { DrawerAsset } from "./AssetDrawer";

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

const AUDIO_EXT = /\.(wav|mp3|m4a|aac|ogg|flac|webm|opus|aiff|aif)$/i;
function isAudioFile(file: File) {
	return String(file.type || "").toLowerCase().startsWith("audio/") || AUDIO_EXT.test(file.name || "");
}

function setTransparentDragImage(dt: DataTransfer) {
	try {
		const canvas = document.createElement("canvas");
		canvas.width = 1;
		canvas.height = 1;
		dt.setDragImage(canvas, 0, 0);
	} catch {}
}

export type ProjectAsset = {
	id: string;
	kind: "audio";
	name: string;

	// Runtime URL for local-only/fallback assets. Server-backed references use objectKey.
	url?: string;

	// The backing GLOBAL object. Project Assets do not make a second physical copy.
	objectKey?: string;
	// Kept for legacy project compatibility; new references normally equal objectKey.
	sourceObjectKey?: string;

	sizeMB?: number;
	durationSec?: number;
};

type Props = {
	projectAssets: ProjectAsset[];
	setProjectAssets: React.Dispatch<React.SetStateAction<ProjectAsset[]>>;
	onDeleteAsset?: (assetId: string) => void;
	onGlobalAssetAdded?: (asset: DrawerAsset) => void;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	hideHandle?: boolean;
	embedded?: boolean;
};

export default function ProjectAssetDrawer(props: Props) {
	const {
		projectAssets,
		setProjectAssets,
		onDeleteAsset,
		onGlobalAssetAdded,
		open: controlledOpen,
		onOpenChange,
		hideHandle = false,
		embedded = false,
	} = props;

	const [openUncontrolled, setOpenUncontrolled] = useState(false);
	const [dragActive, setDragActive] = useState(false);
	const dragCounter = useRef(0);
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

	const importFiles = async (input: File[]) => {
		const files = input.filter(isAudioFile);
		if (!files.length) return;
		setOpen(true);

		const next: ProjectAsset[] = [];
		for (const f of files) {
			try {
				// Upload ONCE to global storage, then reference that exact object from the project.
				const uploaded = await uploadFileToCloud(f);
				const objectKey = String(uploaded?.objectKey || "");
				const id = objectKey || crypto.randomUUID();
				const sizeMB = f.size / (1024 * 1024);
				const projectAsset: ProjectAsset = {
					id,
					kind: "audio",
					name: uploaded?.filename || f.name,
					objectKey: objectKey || undefined,
					sourceObjectKey: objectKey || undefined,
					sizeMB,
				};
				next.push(projectAsset);
				onGlobalAssetAdded?.({
					id,
					name: projectAsset.name,
					sizeMB,
					type: "audio",
					objectKey: objectKey || undefined,
					addedAt: Date.now(),
				});
			} catch {
				// Local fallback still uses one blob reference shared by both drawers.
				const id = crypto.randomUUID();
				const url = URL.createObjectURL(f);
				const sizeMB = f.size / (1024 * 1024);
				next.push({ id, kind: "audio", name: f.name, url, sizeMB });
				onGlobalAssetAdded?.({ id, name: f.name, sizeMB, type: "audio", publicUrl: url, addedAt: Date.now() });
			}
		}

		if (!next.length) return;
		setProjectAssets((prev) => {
			const out = [...prev];
			for (const a of next) {
				if (out.some((p) => p.id === a.id || (!!a.objectKey && p.objectKey === a.objectKey))) continue;
				out.push(a);
			}
			return out;
		});
	};

	const onPickFiles = (e: ChangeEvent<HTMLInputElement>) => {
		const files = Array.from(e.target.files ?? []);
		e.currentTarget.value = "";
		if (!files.length) return;
		void importFiles(files);
	};

	// Bottom drawer handles forward external drops here so dropping directly on
	// a handle works instead of allowing Chrome to open/play the file.
	useEffect(() => {
		const onForwardedDrop = (event: Event) => {
			const files = Array.from((event as CustomEvent<{ files?: File[] }>).detail?.files || []);
			if (files.length) void importFiles(files);
		};
		window.addEventListener("ysong:drop-files-project", onForwardedDrop as EventListener);
		return () => window.removeEventListener("ysong:drop-files-project", onForwardedDrop as EventListener);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const onDragEnter = (e: DragEvent) => {
		if (!Array.from(e.dataTransfer.types || []).includes("Files")) return;
		e.preventDefault();
		e.stopPropagation();
		dragCounter.current += 1;
		setDragActive(true);
		setOpen(true);
	};
	const onDragOver = (e: DragEvent) => {
		if (!Array.from(e.dataTransfer.types || []).includes("Files")) return;
		e.preventDefault();
		e.stopPropagation();
		e.dataTransfer.dropEffect = "copy";
	};
	const onDragLeave = (e: DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		dragCounter.current = Math.max(0, dragCounter.current - 1);
		if (!dragCounter.current) setDragActive(false);
	};
	const onDrop = (e: DragEvent) => {
		if (!Array.from(e.dataTransfer.types || []).includes("Files")) return;
		e.preventDefault();
		e.stopPropagation();
		dragCounter.current = 0;
		setDragActive(false);
		void importFiles(Array.from(e.dataTransfer.files || []));
	};

	const fileKind: FileKind = "audio";
	const sorted = useMemo(() => [...projectAssets], [projectAssets]);

	const panel = (
		<div
			id="project-asset-drawer-panel"
			className={`asset-drawer-panel ${open ? "asset-drawer-panel-open" : "asset-drawer-panel-closed"} ${dragActive ? "asset-drawer-panel-drop-active" : ""}`}
			onDragEnter={onDragEnter}
			onDragOver={onDragOver}
			onDragLeave={onDragLeave}
			onDrop={onDrop}
		>
			<div className="asset-drawer-header">
				<div className="asset-drawer-title">
					PROJECT ASSETS ({sorted.length})
					<span className="asset-drawer-hint">References only — drag onto an audio lane</span>
				</div>
				<div className="asset-drawer-actions">
					<YSButton type="button" className="asset-drawer-add-btn" onClick={triggerPicker} title="Import audio">
						+
					</YSButton>
					<YSButton type="button" onClick={() => setOpen(false)} className="asset-drawer-close-btn">
						Close
					</YSButton>
				</div>
				<input ref={fileInputRef} type="file" multiple className="hidden" onChange={onPickFiles} accept="audio/*" />
			</div>

			<div className="asset-drawer-scroll asset-drawer-dropzone">
				{dragActive && (
					<div className="asset-drawer-dropoverlay">
						<div className="asset-drawer-dropcard">
							<div className="asset-drawer-dropcard-title">Add to Project Assets</div>
							<div className="asset-drawer-dropcard-sub">One upload, shared with the global Asset Drawer.</div>
						</div>
					</div>
				)}
				<div className="asset-drawer-inner">
					{sorted.length === 0 ? (
						<div className="text-[12px] opacity-60 p-2">No project assets yet. Drop audio here, into the DAW, or click +.</div>
					) : (
						<div className="asset-pill-grid">
							{sorted.map((a) => {
								const payload = {
									id: a.id,
									kind: "audio",
									name: a.name,
									url: a.url,
									objectKey: a.objectKey,
									sizeMB: a.sizeMB,
									durationSec: a.durationSec,
								};
								return (
									<div
										key={a.id}
										draggable={a.kind === "audio"}
										onDragStart={(e) => {
											e.dataTransfer.effectAllowed = "link";
											e.dataTransfer.setData("application/x-ysong-asset", JSON.stringify(payload));
											e.dataTransfer.setData("text/plain", "");
											(window as any).__ysongDragAsset = payload;
											setTransparentDragImage(e.dataTransfer);
										}}
										onDragEnd={() => {
											try { delete (window as any).__ysongDragAsset; } catch {}
											window.dispatchEvent(new Event("ysong:asset-drag-end"));
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
							/=====\\
						</YSButton>
					)}
					{panel}
				</div>
			</div>
		);
	}

	return panel;
}
