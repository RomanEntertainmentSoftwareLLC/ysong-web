// src/components/BottomDrawers.tsx
import { useEffect, useMemo, useState, type DragEvent } from "react";
import "../styles/asset-drawer.css";

import type { Chat } from "./UISidebar";
import { YSButton } from "./YSButton";

import AssetDrawer, { type DrawerAsset } from "./AssetDrawer";
import ProjectAssetDrawer, { type ProjectAsset } from "./ProjectAssetDrawer";
import PersonaAssetDrawer from "./PersonaAssetDrawer";

type DrawerId = "personas" | "assets" | "project" | null;

type Props = {
	chats: Chat[];
	setChats: React.Dispatch<React.SetStateAction<Chat[]>>;

	drawerAssets: DrawerAsset[];
	setDrawerAssets: React.Dispatch<React.SetStateAction<DrawerAsset[]>>;
	activeChatId?: string;

	projectAssets: ProjectAsset[];
	setProjectAssets: React.Dispatch<React.SetStateAction<ProjectAsset[]>>;

	// The drawer dock follows the actual workspace instead of assuming the old
	// permanently-open 280px sidebar.
	workspaceLeftPx?: number;
	activeContext?: "chat" | "room" | "daw" | null;
};

function getActiveProjectId() {
	try {
		return localStorage.getItem("ysong:activeProjectId") || "default";
	} catch {
		return "default";
	}
}

function normalizeProjectAssetForPersist<T extends { objectKey?: string; url?: string }>(asset: T): T {
	if (asset?.objectKey) return { ...asset, url: undefined };
	return asset;
}

function hasExternalFiles(e: DragEvent) {
	return Array.from(e.dataTransfer?.types || []).includes("Files");
}

export default function BottomDrawers({
	chats,
	setChats,
	drawerAssets,
	setDrawerAssets,
	activeChatId,
	projectAssets,
	setProjectAssets,
	workspaceLeftPx = 0,
	activeContext = null,
}: Props) {
	const [openDrawer, setOpenDrawer] = useState<DrawerId>(null);
	const [drawerDragTarget, setDrawerDragTarget] = useState<"assets" | "project" | null>(null);

	useEffect(() => {
		const onOpenDrawer = (event: Event) => {
			const id = (event as CustomEvent)?.detail?.id as Exclude<DrawerId, null> | undefined;
			if (id === "personas" || id === "assets" || id === "project") setOpenDrawer(id);
		};
		window.addEventListener("ysong:open-drawer", onOpenDrawer as EventListener);
		return () => window.removeEventListener("ysong:open-drawer", onOpenDrawer as EventListener);
	}, []);

	const projectId = useMemo(() => getActiveProjectId(), []);

	// MVP persistence for the project reference list. These are references to
	// global assets, not duplicate physical uploads.
	useEffect(() => {
		try {
			const key = `ysong:projectAssets:${projectId}`;
			const raw = localStorage.getItem(key);
			if (!raw) return;
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed) && parsed.length && projectAssets.length === 0) {
				setProjectAssets(parsed.map(normalizeProjectAssetForPersist));
			}
		} catch {}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [projectId]);

	useEffect(() => {
		try {
			const key = `ysong:projectAssets:${projectId}`;
			localStorage.setItem(key, JSON.stringify(projectAssets.map(normalizeProjectAssetForPersist)));
		} catch {}
	}, [projectAssets, projectId]);

	const toggle = (id: Exclude<DrawerId, null>) => {
		setOpenDrawer((prev) => (prev === id ? null : id));
	};

	// A project asset is a REFERENCE to the same backing asset. No /copy call.
	const addDrawerAssetToProject = async (asset: DrawerAsset) => {
		const id = asset.objectKey ?? asset.id;
		setProjectAssets((prev) => {
			if (prev.some((p) => p.id === id || (!!asset.objectKey && p.objectKey === asset.objectKey))) return prev;
			return [
				...prev,
				{
					id,
					kind: "audio" as const,
					name: asset.name,
					objectKey: asset.objectKey,
					sourceObjectKey: asset.objectKey,
					sizeMB: asset.sizeMB,
					url: asset.objectKey ? undefined : asset.publicUrl,
				},
			];
		});
		setOpenDrawer("project");
	};

	const registerGlobalAsset = (asset: DrawerAsset) => {
		setDrawerAssets((prev) => {
			const id = asset.objectKey ?? asset.id;
			if ((prev || []).some((a) => a.id === id || (!!asset.objectKey && a.objectKey === asset.objectKey))) return prev;
			return [{ ...asset, id }, ...(prev || [])];
		});
	};

	const onHandleDragOver = (id: "assets" | "project") => (e: DragEvent<HTMLDivElement>) => {
		if (!hasExternalFiles(e)) return;
		e.preventDefault();
		e.stopPropagation();
		e.dataTransfer.dropEffect = "copy";
		setDrawerDragTarget(id);
		setOpenDrawer(id);
	};

	const onHandleDragLeave = (id: "assets" | "project") => (e: DragEvent<HTMLDivElement>) => {
		const next = e.relatedTarget as Node | null;
		if (next && e.currentTarget.contains(next)) return;
		setDrawerDragTarget((current) => (current === id ? null : current));
	};

	const onHandleDrop = (id: "assets" | "project") => (e: DragEvent<HTMLDivElement>) => {
		if (!hasExternalFiles(e)) return;
		e.preventDefault();
		e.stopPropagation();
		const files = Array.from(e.dataTransfer.files || []);
		setDrawerDragTarget(null);
		setOpenDrawer(id);
		if (!files.length) return;
		window.dispatchEvent(
			new CustomEvent(id === "assets" ? "ysong:drop-files-assets" : "ysong:drop-files-project", {
				detail: { files },
			}),
		);
	};

	const HANDLE_W = 78;

	return (
		<div className="asset-drawer-shell" style={{ left: workspaceLeftPx }}>
			<div className="w-full max-w-[720px] px-2 sm:px-4 pb-[env(safe-area-inset-bottom,0px)] flex flex-col items-center">
				<div className="w-full flex justify-center">
					<div className="pointer-events-auto inline-flex items-center gap-2">
						<YSButton
							type="button"
							onClick={() => toggle("personas")}
							className="asset-drawer-handle"
							style={{ width: HANDLE_W }}
							aria-expanded={openDrawer === "personas"}
							aria-controls="persona-asset-drawer-panel"
							aria-label="Toggle Personas drawer"
							title="Personas"
						>
							/=====\\
						</YSButton>

						<div
							className={drawerDragTarget === "assets" ? "asset-drawer-handle-wrap-drop-active" : ""}
							onDragEnter={onHandleDragOver("assets")}
							onDragOver={onHandleDragOver("assets")}
							onDragLeave={onHandleDragLeave("assets")}
							onDrop={onHandleDrop("assets")}
						>
							<YSButton
								type="button"
								onClick={() => toggle("assets")}
								className={`asset-drawer-handle ${drawerDragTarget === "assets" ? "asset-drawer-handle-drop-active" : ""}`}
								style={{ width: HANDLE_W }}
								aria-expanded={openDrawer === "assets"}
								aria-controls="asset-drawer-panel"
								aria-label="Toggle Assets drawer"
								title="Assets"
							>
								/=====\\
							</YSButton>
						</div>

						<div
							className={drawerDragTarget === "project" ? "asset-drawer-handle-wrap-drop-active" : ""}
							onDragEnter={onHandleDragOver("project")}
							onDragOver={onHandleDragOver("project")}
							onDragLeave={onHandleDragLeave("project")}
							onDrop={onHandleDrop("project")}
						>
							<YSButton
								type="button"
								onClick={() => toggle("project")}
								className={`asset-drawer-handle ${drawerDragTarget === "project" ? "asset-drawer-handle-drop-active" : ""}`}
								style={{ width: HANDLE_W }}
								aria-expanded={openDrawer === "project"}
								aria-controls="project-asset-drawer-panel"
								aria-label="Toggle Project Assets drawer"
								title="Project Assets"
							>
								/=====\\
							</YSButton>
						</div>
					</div>
				</div>

				<div className="w-full mt-2">
					<PersonaAssetDrawer
						embedded
						hideHandle
						open={openDrawer === "personas"}
						onOpenChange={(v) => setOpenDrawer(v ? "personas" : null)}
						activeContext={activeContext}
						activeChatId={activeChatId}
					/>

					<AssetDrawer
						embedded
						hideHandle
						open={openDrawer === "assets"}
						onOpenChange={(v) => setOpenDrawer(v ? "assets" : null)}
						chats={chats}
						setChats={setChats}
						drawerAssets={drawerAssets}
						setDrawerAssets={setDrawerAssets}
						activeChatId={activeChatId}
						onAddToProject={addDrawerAssetToProject}
					/>

					<ProjectAssetDrawer
						embedded
						hideHandle
						open={openDrawer === "project"}
						onOpenChange={(v) => setOpenDrawer(v ? "project" : null)}
						projectAssets={projectAssets}
						setProjectAssets={setProjectAssets}
						onGlobalAssetAdded={registerGlobalAsset}
						onDeleteAsset={(assetId) => {
							const hit = projectAssets.find((a) => a.id === assetId);
							setProjectAssets((prev) => prev.filter((a) => a.id !== assetId));
							// Removing from Project Assets removes project clips/references, but
							// deliberately leaves the global physical asset untouched.
							window.dispatchEvent(
								new CustomEvent("ysong:asset-deleted", {
									detail: {
										assetId,
										objectKey: hit?.objectKey,
										sourceObjectKey: hit?.sourceObjectKey,
										name: hit?.name,
										projectReferenceOnly: true,
									},
								}),
							);
						}}
					/>
				</div>
			</div>
		</div>
	);
}
