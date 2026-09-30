import { useEffect, useState } from "react";
import { promotionApi, type AdCreative, type ReusableAdCreative } from "./api";
import type { CreativeStudioProject } from "./creativeStudioProject";
import CreativeStudioTimeline from "./CreativeStudioTimeline";

/** Opens a reusable creative's edit source without moving ownership to its campaign binding. */
export default function CreativeStudioPanel({ creative, mediaUrls, audioUrl }: { creative: AdCreative; mediaUrls: Record<string, string>; audioUrl: string }) {
  const [project, setProject] = useState<CreativeStudioProject | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const owner = creative.stableCreativeId && creative.audioSnippets && creative.backgroundMedia
    ? { id: creative.stableCreativeId, name: `Creative ${creative.stableCreativeId.slice(0, 8)}`, audioSnippets: creative.audioSnippets, backgroundMedia: creative.backgroundMedia } satisfies Pick<ReusableAdCreative,"id"|"name"|"audioSnippets"|"backgroundMedia">
    : null;
  useEffect(() => {
    if (!owner) { setLoading(false); setError("This campaign render has no reusable creative edit source yet."); return; }
    let active = true;
    setLoading(true);
    setError("");
    void promotionApi.loadStudioProject(owner).then(value => { if (active) { setProject(value); setLoading(false); } }).catch(cause => { if (active) { setError(cause instanceof Error ? cause.message : "Could not load this creative's project."); setLoading(false); } });
    return () => { active = false; };
    // The source identity and revision determine the read. Campaign render refreshes do not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creative.stableCreativeId]);
  if (loading) return <p className="mt-3 text-xs text-neutral-500">Loading Creative Studio project…</p>;
  if (error) return <p role="alert" className="mt-3 text-xs text-amber-600 dark:text-amber-300">{error}</p>;
  if (!owner) return null;
  const emptyProject: CreativeStudioProject = {
    schemaVersion: 1, revision: 0, durationFrames: Math.round(Math.max(1, Math.min(60, creative.timing?.durationSeconds || creative.durationSeconds || 30)) * 30),
    timebase: { framesPerSecond: { numerator: 30, denominator: 1 } },
    tracks: [{ id: "visual", kind: "visual", clips: [] }, { id: "text", kind: "text", clips: [] }, { id: "audio", kind: "audio", clips: [] }],
    render: { width: 1080, height: 1920, videoCodec: "h264", audioCodec: "aac", backgroundColor: "#000000" },
    edit: { createdAt: creative.createdAt, updatedAt: creative.updatedAt, source: "artist" },
  };
  return <div className="mt-3">{!project && <p className="mb-2 text-xs text-neutral-500">No saved timeline project. Tracks are empty until an edit is created.</p>}<CreativeStudioTimeline creative={owner} project={project || emptyProject} mediaUrls={mediaUrls} audioUrl={audioUrl} /></div>;
}
