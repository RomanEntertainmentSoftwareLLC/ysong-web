// src/components/BottomDrawers.tsx
import { useState } from "react";
import "../styles/asset-drawer.css";

import type { Chat } from "./UISidebar";
import { YSButton } from "./YSButton";

import AssetDrawer, { type DrawerAsset } from "./AssetDrawer";
import ProjectAssetDrawer, { type ProjectAsset } from "./ProjectAssetDrawer";

type DrawerId = "assets" | "project" | null;

type Props = {
    chats: Chat[];
    setChats: React.Dispatch<React.SetStateAction<Chat[]>>;

    drawerAssets: DrawerAsset[];
    setDrawerAssets: React.Dispatch<React.SetStateAction<DrawerAsset[]>>;
    activeChatId?: string;

    projectAssets: ProjectAsset[];
    setProjectAssets: React.Dispatch<React.SetStateAction<ProjectAsset[]>>;
};

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

    const toggle = (id: Exclude<DrawerId, null>) => {
        setOpenDrawer((prev) => (prev === id ? null : id));
    };

    // Tune these if you change handle width or gap:
    // gap-2 = 8px, width = 78px -> shift = (78 + 8)/2 = 43px
    const HANDLE_W = 78;

    return (
        <div className="asset-drawer-shell">
            <div className="w-full max-w-[720px] px-4 pb-[env(safe-area-inset-bottom,0px)] flex flex-col items-center">
                {/* HANDLE ROW */}
                <div className="w-full flex justify-center">
                    <div
                        className="pointer-events-auto inline-flex items-center gap-2"
                        style={{
                            transform: `translateX(${(HANDLE_W + 8) / 2}px)`,
                        }}
                    >
                        {/* Assets */}
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

                        {/* Project Assets */}
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
                    />

                    <ProjectAssetDrawer
                        embedded
                        hideHandle
                        open={openDrawer === "project"}
                        onOpenChange={(v) =>
                            setOpenDrawer(v ? "project" : null)
                        }
                        projectAssets={projectAssets}
                        setProjectAssets={setProjectAssets}
                    />
                </div>
            </div>
        </div>
    );
}
