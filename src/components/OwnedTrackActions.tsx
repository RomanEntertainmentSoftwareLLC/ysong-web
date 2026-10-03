import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { WorldTrack } from "../lib/worldApi";

export default function OwnedTrackActions({ track, onEdit }: { track: WorldTrack; onEdit: (track: WorldTrack) => void }) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    const close = () => setPosition(null);
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    if (!position) return;
    window.addEventListener("keydown", escape);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => { window.removeEventListener("keydown", escape); window.removeEventListener("resize", close); window.removeEventListener("scroll", close, true); };
  }, [position]);
  if (!track.isOwner) return null;
  return <>
    <button type="button" aria-label={`Edit actions for ${track.title}`} aria-haspopup="menu" aria-expanded={!!position} className="h-8 w-8 shrink-0 rounded-lg hover:bg-neutral-800 text-neutral-300 text-xl leading-none" onClick={event => {
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      setPosition(position ? null : { left: Math.max(8, Math.min(rect.right - 210, window.innerWidth - 218)), top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 76)) });
    }}>⋮</button>
    {position && createPortal(<><button type="button" className="fixed inset-0 z-[77] cursor-default" aria-label="Close track actions" onClick={() => setPosition(null)} /><div role="menu" className="fixed z-[78] w-[210px] rounded-xl border border-neutral-700 bg-neutral-950 p-1 shadow-2xl text-sm" style={position}><button type="button" role="menuitem" className="w-full rounded-lg px-3 py-2 text-left hover:bg-neutral-800" onClick={() => { setPosition(null); if (track.isOwner) onEdit(track); }}>✎ Edit Track</button></div></>, document.body)}
  </>;
}
