// src/components/AssetDrawer.tsx
import { useState, useEffect, useRef } from "react";

type Asset = {
    id: string;
    name: string;
    sizeMB: number;
    type: "audio" | "file";
};

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
];

export default function AssetDrawer() {
    const [open, setOpen] = useState(false);
    const handleRef = useRef<HTMLButtonElement | null>(null);

    // Keep axe happy: update aria-expanded after render with a string token
    useEffect(() => {
        if (handleRef.current) {
            handleRef.current.setAttribute(
                "aria-expanded",
                open ? "true" : "false"
            );
        }
    }, [open]);

    return (
        // On desktop, start to the right of the 280px sidebar:
        // left-0 on mobile, lg:left-[280px] on large screens.
        <div className="fixed bottom-0 right-0 z-[60] flex justify-center pointer-events-none left-0 lg:left-[280px]">
            {/* Layout only – no pointer-events here */}
            <div className="w-full max-w-[720px] px-4 pb-[env(safe-area-inset-bottom,0px)] flex flex-col items-center space-y-2">
                {/* Handle button */}
                <button
                    ref={handleRef}
                    type="button"
                    onClick={() => setOpen((v) => !v)}
                    className="pointer-events-auto mx-auto flex items-center justify-center rounded-full
                               bg-neutral-900/85 text-neutral-50 text-[11px] font-mono
                               px-4 py-1 border border-neutral-700 shadow-lg
                               hover:bg-neutral-800
                               dark:bg-neutral-900/85 dark:border-neutral-700"
                    aria-expanded="false"
                    aria-controls="asset-drawer-panel"
                >
                    /=====\
                </button>

                {/* Drawer panel */}
                <div
                    id="asset-drawer-panel"
                    className={`pointer-events-auto overflow-hidden rounded-t-2xl border border-neutral-800
                                bg-neutral-950/95 shadow-2xl w-full
                                transition-all duration-300 ease-out origin-bottom
                                ${
                                    open
                                        ? "max-h-[25vh] opacity-100 translate-y-0"
                                        : "max-h-0 opacity-0 translate-y-2"
                                }`}
                >
                    {/* Header row */}
                    <div className="flex items-center justify-between px-4 py-2 border-b border-neutral-800">
                        <div className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                            Assets
                        </div>
                        <button
                            type="button"
                            onClick={() => setOpen(false)}
                            className="pointer-events-auto rounded-md px-2 py-1 text-[11px] text-neutral-400
                                       hover:bg-neutral-800 hover:text-neutral-100"
                        >
                            Close
                        </button>
                    </div>

                    {/* Content area – grid of equal-width pills */}
                    <div className="h-[25vh] min-h-[160px] max-h-[320px] overflow-y-auto">
                        <div className="mx-auto w-full max-w-[720px] px-4 sm:px-6 pt-3">
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                {MOCK_ASSETS.map((asset) => {
                                    const isAudio = asset.type === "audio";
                                    const sizeMB = asset.sizeMB.toFixed(1);

                                    return (
                                        <div
                                            key={asset.id}
                                            className="w-full flex items-center gap-3 rounded-2xl border border-neutral-300
													bg-neutral-50/90 px-3 py-2 text-xs sm:text-sm shadow-sm
													dark:border-neutral-700 dark:bg-neutral-900/70"
                                            title={asset.name} // hover shows full name
                                        >
                                            {/* Icon + mini waveform for audio */}
                                            <div className="flex flex-col items-center justify-center">
                                                <div
                                                    className="flex h-8 w-8 items-center justify-center rounded-xl
																bg-neutral-200 text-neutral-800
																dark:bg-neutral-800 dark:text-neutral-50"
                                                >
                                                    {isAudio ? "🎵" : "📎"}
                                                </div>
                                                {isAudio && (
                                                    <div className="mt-1 flex h-4 items-end gap-[2px] text-[0]">
                                                        {Array.from({
                                                            length: 12,
                                                        }).map((_, barIdx) => (
                                                            <span
                                                                key={barIdx}
                                                                className="flex-1 rounded-full bg-neutral-400/80 dark:bg-neutral-500/80"
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

                                            {/* Name + meta */}
                                            <div className="min-w-0 flex-1">
                                                <span className="block truncate font-medium">
                                                    {asset.name}
                                                </span>
                                                <span className="mt-0.5 block text-[10px] uppercase tracking-wide opacity-70">
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
