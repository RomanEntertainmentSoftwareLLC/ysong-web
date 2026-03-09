// src/components/ProjectAssetDrawer.tsx
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import "../styles/asset-drawer.css";

import { YSButton } from "./YSButton";
import { FilePill, type FileKind } from "./FilePill";

export type ProjectAsset = {
	id: string;
	kind: "audio";
	name: string;

	// Either local blob URL (imports) or a signed URL (runtime).
	url?: string;

	// Cloud object key for persisted assets.
	objectKey?: string;

	durationSec?: number;
};

type Props = {
	projectAssets: ProjectAsset[];
	setProjectAssets: React.Dispatch<React.SetStateAction<ProjectAsset[]>>;
	onDeleteAsset?: (assetId: string) => void;

	// dock-control (so only one drawer can be open)
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	hideHandle?: boolean; // unused in dock mode, but supported
	embedded?: boolean; // render panel only (no fixed shell)
};

function fmtDur(sec?: number) {
	if (!Number.isFinite(sec as number) || sec == null) return "—";
	const s = Math.max(0, Math.floor(sec));
	const m = Math.floor(s / 60);
	const r = s % 60;
	return `${m}:${String(r).padStart(2, "0")}`;
}


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

	// Expose setter so the DAW tab can add assets into the Project drawer on drop.
	useEffect(() => {
		try {
			(window as any).__ysongProjectAssets = projectAssets;
			(window as any).__ysongSetProjectAssets = setProjectAssets;
		} catch {
			// ignore
		}
	}, [projectAssets, setProjectAssets]);

	const handleRef = useRef<HTMLButtonElement | null>(null);
	const fileInputRef = useRef<HTMLInputElement | null>(null);

	const triggerPicker = () => {
		setOpen(true);
		fileInputRef.current?.click();
	};

	const onPickFiles = (e: ChangeEvent<HTMLInputElement>) => {
		const files = Array.from(e.target.files ?? []);
		e.currentTarget.value = "";
		if (!files.length) return;

		const next: ProjectAsset[] = files
			.filter((f) => (f.type || "").toLowerCase().startsWith("audio/"))
			.map((f) => ({
				id: crypto.randomUUID(),
				kind: "audio" as const,
				name: f.name,
				url: URL.createObjectURL(f),
				objectKey: undefined,
			}));

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
			{/* header */}
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

			{/* content */}
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
										draggable
										onDragStart={(e) => {
											e.dataTransfer.effectAllowed = "copy";
											e.dataTransfer.setData(
												"application/x-ysong-asset",
												JSON.stringify(payload),
											);
											e.dataTransfer.setData("text/plain", "");
							const pill = (e.currentTarget as HTMLElement).querySelector(".asset-pill") as HTMLElement | null;
							const ghost = pill ? makePillCloneGhost(pill) : null;
							if (ghost) {
								const rect = ghost.getBoundingClientRect();
								e.dataTransfer.setDragImage(ghost, Math.min(28, rect.width / 2), Math.min(18, rect.height / 2));
								setTimeout(() => { try { ghost.remove(); } catch {} }, 600);
							}
										}}
										title={`Drag: ${a.name}`}
									>
										<FilePill
											id={a.id}
											name={a.name}
											sizeMB={0}
											type={fileKind as any}
											publicUrl={a.url}
											objectKey={a.objectKey}
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

	// If used standalone (not your dock), allow optional handle rendering.
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

	// Dock mode: panel only
	return panel;
}
