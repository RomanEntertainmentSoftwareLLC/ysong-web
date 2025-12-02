// src/components/AssetDrawer.tsx
import { useState, useEffect, useRef } from "react";
import "../styles/asset-drawer.css";

// Simple type for an asset in the drawer
type Asset = {
    id: string;
    name: string;
    sizeMB: number;
    type: "audio" | "file";
};

// Temporary mock data so the drawer isn't empty
const MOCK_ASSETS: Asset[] = [
    {
        id: "1",
        name: "Cybotron - Clear (Jose Remix).flac",
        sizeMB: 11.3,
        type: "audio",
    },
    {
        id: "2",
        name: "Drum Loop - 120 BPM.wav",
        sizeMB: 4.7,
        type: "audio",
    },
    {
        id: "3",
        name: "Pad Atmosphere 01.wav",
        sizeMB: 7.1,
        type: "audio",
    },
    {
        id: "4",
        name: "FX Riser Short.wav",
        sizeMB: 2.2,
        type: "audio",
    },
    {
        id: "5",
        name: "Test.wav",
        sizeMB: 2.2,
        type: "audio",
    },
    {
        id: "6",
        name: "Uh Huh.wav",
        sizeMB: 2.2,
        type: "audio",
    },
    {
        id: "7",
        name: "Planet Rock Beat.wav",
        sizeMB: 2.2,
        type: "audio",
    },
];

export default function AssetDrawer() {
    const [open, setOpen] = useState(false);
    const handleRef = useRef<HTMLButtonElement | null>(null);

    useEffect(() => {
        if (handleRef.current) {
            handleRef.current.setAttribute(
                "aria-expanded",
                open ? "true" : "false"
            );
        }
    }, [open]);

    return (
        // NOTE: responsive offset for sidebar is added here, not in @apply
        <div className="asset-drawer-shell lg:left-[280px]">
            <div className="asset-drawer-container">
                {/* handle */}
                <button
                    ref={handleRef}
                    type="button"
                    onClick={() => setOpen((v) => !v)}
                    className="asset-drawer-handle"
                    aria-expanded="false"
                    aria-controls="asset-drawer-panel"
                >
                    /=====\
                </button>

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
                        <div className="asset-drawer-title">Assets</div>
                        <button
                            type="button"
                            onClick={() => setOpen(false)}
                            className="asset-drawer-close-btn"
                        >
                            Close
                        </button>
                    </div>

                    {/* scrollable content */}
                    <div className="asset-drawer-scroll">
                        {/* add sm:px-6 here instead of in @apply */}
                        <div className="asset-drawer-inner sm:px-6">
                            {/* add sm:grid-cols-3 here instead of in @apply */}
                            <div className="asset-pill-grid sm:grid-cols-3">
                                {MOCK_ASSETS.map((asset) => {
                                    const isAudio = asset.type === "audio";
                                    const sizeMB = asset.sizeMB.toFixed(1);

                                    return (
                                        <div
                                            key={asset.id}
                                            // add sm:text-sm here instead of in @apply
                                            className="asset-pill sm:text-sm"
                                            title={asset.name}
                                        >
                                            {/* icon + tiny waveform */}
                                            <div className="asset-pill-icon-wrapper">
                                                <div className="asset-pill-icon-box">
                                                    {isAudio ? "🎵" : "📎"}
                                                </div>
                                                {isAudio && (
                                                    <div className="asset-pill-wave">
                                                        {Array.from({
                                                            length: 12,
                                                        }).map((_, barIdx) => (
                                                            <span
                                                                key={barIdx}
                                                                className="asset-pill-wave-bar"
                                                                style={{
                                                                    height: `${
                                                                        4 +
                                                                        ((barIdx *
                                                                            7) %
                                                                            10)
                                                                    }px`,
                                                                }}
                                                            />
                                                        ))}
                                                    </div>
                                                )}
                                            </div>

                                            {/* text */}
                                            <div className="asset-pill-text">
                                                <span className="asset-pill-name">
                                                    {asset.name}
                                                </span>
                                                <span className="asset-pill-meta">
                                                    {isAudio
                                                        ? "Audio file"
                                                        : "Asset"}{" "}
                                                    · {sizeMB} MB
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
