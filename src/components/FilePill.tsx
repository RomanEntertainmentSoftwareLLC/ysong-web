// src/components/FilePill.tsx
import "../styles/file-pill.css";

export type FileKind = "audio" | "file";

export interface FileAsset {
    id: string;
    name: string;
    sizeMB: number;
    type: FileKind;
}

interface FilePillProps extends FileAsset {}

/**
 * FilePill
 *  - Dark pill that looks the same in light + dark themes.
 *  - If `type === "audio"`, shows the tiny waveform.
 *  - Later we can drop the mini-player controls in here.
 */
export function FilePill({ name, sizeMB, type }: FilePillProps) {
    const isAudio = type === "audio";
    const displaySize = sizeMB.toFixed(1);

    return (
        <div className="asset-pill max-w-[200px]" title={name}>
            {/* LEFT: icon + tiny waveform */}
            <div className="asset-pill-icon-wrapper">
                <div className="asset-pill-icon-box">
                    {isAudio ? "🎵" : "📎"}
                </div>
                {isAudio && (
                    <div className="asset-pill-wave" aria-hidden="true">
                        {Array.from({ length: 12 }).map((_, barIdx) => (
                            <span
                                key={barIdx}
                                className="asset-pill-wave-bar"
                                style={{
                                    height: `${4 + ((barIdx * 7) % 10)}px`,
                                }}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* RIGHT: name + meta */}
            <div className="asset-pill-text">
                <span className="asset-pill-name">{name}</span>
                <span className="asset-pill-meta">
                    {isAudio ? "Audio file" : "Asset"} · {displaySize} MB
                </span>
            </div>
        </div>
    );
}
