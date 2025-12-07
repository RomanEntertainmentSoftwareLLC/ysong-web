import { useState, useEffect, useRef } from "react";
import "../styles/asset-drawer.css";
import { YSButton } from "./YSButton";
import { FilePill, type FileAsset } from "./FilePill";

// Temporary mock data so the drawer isn't empty
const MOCK_ASSETS: FileAsset[] = [
    {
        id: "1",
        name: "Cybotron - Clear (Jose Remix).flac",
        sizeMB: 11.3,
        type: "audio",
    },
    { id: "2", name: "Drum Loop - 120 BPM.wav", sizeMB: 4.7, type: "audio" },
    { id: "3", name: "Pad Atmosphere 01.wav", sizeMB: 7.1, type: "audio" },
    { id: "4", name: "FX Riser Short.wav", sizeMB: 2.2, type: "audio" },
    { id: "5", name: "Test.wav", sizeMB: 2.2, type: "audio" },
    { id: "6", name: "Uh Huh.wav", sizeMB: 2.2, type: "audio" },
    { id: "7", name: "Planet Rock Beat.wav", sizeMB: 2.2, type: "audio" },
];

export default function AssetDrawer() {
    const [open, setOpen] = useState(false);
    const handleRef = useRef<HTMLButtonElement | null>(null);

    // Keep aria-expanded in sync with state
    useEffect(() => {
        if (handleRef.current) {
            handleRef.current.setAttribute(
                "aria-expanded",
                open ? "true" : "false"
            );
        }
    }, [open]);

    return (
        <div className="asset-drawer-shell">
            <div className="asset-drawer-container">
                {/* handle */}
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

                {/* panel */}
                <div
                    id="asset-drawer-panel"
                    className={`asset-drawer-panel ${
                        open
                            ? "asset-drawer-panel-open"
                            : "asset-drawer-panel-closed"
                    }`}
                >
                    {/* header */}
                    <div className="asset-drawer-header">
                        <div className="asset-drawer-title">ASSETS</div>
                        <YSButton
                            type="button"
                            onClick={() => setOpen(false)}
                            className="asset-drawer-close-btn"
                        >
                            Close
                        </YSButton>
                    </div>

                    {/* scrollable content */}
                    <div className="asset-drawer-scroll">
                        <div className="asset-drawer-inner">
                            <div className="asset-pill-grid">
                                {MOCK_ASSETS.map((asset) => (
                                    <FilePill key={asset.id} {...asset} />
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
