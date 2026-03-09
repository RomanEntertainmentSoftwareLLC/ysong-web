// src/components/BottomDrawers.tsx
import { useEffect, useMemo, useState } from "react";
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
};


const env = (import.meta as any).env || {};
const API_BASE = env.VITE_AUTH_API_URL || env.VITE_API_BASE_URL || "";
const API = (API_BASE || "").replace(/\/+$/, "");

function getActiveProjectId() {
	// For now, MVP uses a single "default" project unless DAW sets a specific id.
	try {
		return localStorage.getItem("ysong:activeProjectId") || "default";
	} catch {
		return "default";
	}
}

async function copyUploadIntoProject(objectKey: string, projectId: string) {
	// Avoid 404s on production until /api/uploads/copy is deployed
	try {
		if (localStorage.getItem("ysong:enableCopy") !== "1") {
			const baseStr = String(API_BASE || "").toLowerCase();
			if (baseStr.includes("api.ysong.ai")) return objectKey;
		}
	} catch {}

	const token = localStorage.getItem("ys_token");
	if (!token) throw new Error("no_token");

	const base = API ? API.replace(/\/+$/, "") + "/api/uploads/copy" : "/api/uploads/copy";
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
	const newKey = String(data?.objectKey || data?.newObjectKey || "");
	if (!newKey) throw new Error("copy_missing_objectKey");
	return newKey;
}


export default function BottomDrawers({
	chats,
	setChats,
	drawerAssets,
	setDrawerAssets,
	activeChatId,
	projectAssets,
	setProjectAssets,
}: Props) {
	const [openDrawer, setOpenDrawer] = useState<DrawerId>(null);

	const projectId = useMemo(() => getActiveProjectId(), []);

	// Load persisted project assets (MVP persistence)
	useEffect(() => {
		try {
			const key = `ysong:projectAssets:${projectId}`;
			const raw = localStorage.getItem(key);
			if (!raw) return;
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed) && parsed.length && projectAssets.length === 0) {
				setProjectAssets(parsed);
			}
		} catch {
			// ignore
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [projectId]);

	useEffect(() => {
		try {
			const key = `ysong:projectAssets:${projectId}`;
			localStorage.setItem(key, JSON.stringify(projectAssets));
		} catch {
			// ignore
		}
	}, [projectAssets, projectId]);


	const toggle = (id: Exclude<DrawerId, null>) => {
		setOpenDrawer((prev) => (prev === id ? null : id));
	};

	const addDrawerAssetToProject = async (asset: DrawerAsset) => {
		if (!asset.objectKey) return;

		const base = {
			id: asset.objectKey, // stable id
			kind: "audio" as const,
			name: asset.name,
			objectKey: asset.objectKey,
			url: undefined as any,
		};

		// Try to make a real cloud copy under project-assets/, but fall back to referencing the original.
		let keyToUse = asset.objectKey;
		try {
			keyToUse = await copyUploadIntoProject(asset.objectKey, projectId);
		} catch {
			// ok to fall back for now
		}

		setProjectAssets((prev) => {
			if (prev.some((p) => p.objectKey === keyToUse || p.id === keyToUse)) return prev;
			return [
				...prev,
				{
					...base,
					id: keyToUse,
					objectKey: keyToUse,
				},
			];
		});

		setOpenDrawer("project");
	};


	// Tune these if you change handle width or gap:
	// gap-2 = 8px, width = 78px -> shift = (78 + 8)/2 = 43px
	const HANDLE_W = 78;

	return (
		<div className="asset-drawer-shell">
			<div className="w-full max-w-[720px] px-4 pb-[env(safe-area-inset-bottom,0px)] flex flex-col items-center">
				{/* HANDLE ROW */}
				<div className="w-full flex justify-center">
					<div className="pointer-events-auto inline-flex items-center gap-2">
						{/* Personas (LEFT) */}
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
							/=====\
						</YSButton>

						{/* Assets (CENTER) */}
						<YSButton
							type="button"
							onClick={() => toggle("assets")}
							className="asset-drawer-handle"
							style={{ width: HANDLE_W }}
							aria-expanded={openDrawer === "assets"}
							aria-controls="asset-drawer-panel"
							aria-label="Toggle Assets drawer"
							title="Assets"
						>
							/=====\
						</YSButton>

						{/* Project Assets (RIGHT) */}
						<YSButton
							type="button"
							onClick={() => toggle("project")}
							className="asset-drawer-handle"
							style={{ width: HANDLE_W }}
							aria-expanded={openDrawer === "project"}
							aria-controls="project-asset-drawer-panel"
							aria-label="Toggle Project Assets drawer"
							title="Project Assets"
						>
							/=====\
						</YSButton>
					</div>
				</div>

				{/* PANELS */}
				<div className="w-full mt-2">
					<PersonaAssetDrawer
						embedded
						hideHandle
						open={openDrawer === "personas"}
						onOpenChange={(v) => setOpenDrawer(v ? "personas" : null)}
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
					/>
				</div>
			</div>
		</div>
	);
}
