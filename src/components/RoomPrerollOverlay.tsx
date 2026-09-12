import { useEffect, useRef, useState } from "react";
import type { YSongVideoPrerollDecision } from "../lib/ysongAds";

export default function RoomPrerollOverlay({ roomName, decision, onComplete, onCancel }: { roomName: string; decision: YSongVideoPrerollDecision; onComplete: () => void; onCancel: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(decision.creative.durationSeconds || 0);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = decision.creative.mutedByDefault;
    video.volume = 0.9;
    void video.play().catch(() => setBlocked(true));
  }, [decision.creative.videoUrl, decision.creative.mutedByDefault]);

  const progress = duration > 0 ? Math.max(0, Math.min(1, time / duration)) : 0;
  return <div className="fixed inset-0 z-[180] grid place-items-center bg-black p-4">
    <div className="w-full max-w-4xl overflow-hidden rounded-2xl border border-white/10 bg-neutral-950 text-white shadow-2xl">
      <div className="relative aspect-video bg-black">
        <video
          ref={videoRef}
          src={decision.creative.videoUrl}
          preload="auto"
          playsInline
          className="h-full w-full object-contain"
          onTimeUpdate={(e)=>setTime(e.currentTarget.currentTime||0)}
          onLoadedMetadata={(e)=>{if(Number.isFinite(e.currentTarget.duration))setDuration(e.currentTarget.duration)}}
          onEnded={onComplete}
        />
        <div className="pointer-events-none absolute left-3 top-3 rounded bg-black/70 px-2 py-1 text-[10px] font-bold uppercase tracking-[.18em] text-amber-200">Sponsored</div>
      </div>
      <div className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><div className="text-lg font-semibold">{decision.creative.title || "Sponsored message"}</div><div className="mt-0.5 text-xs text-neutral-500">{decision.creative.sponsor || "Sponsor"} · before entering {roomName}</div></div>
          <button onClick={onCancel} className="rounded-lg border border-neutral-800 px-3 py-2 text-xs text-neutral-500 hover:text-white">Cancel</button>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-neutral-800"><div className="h-full bg-amber-400 transition-[width] duration-200" style={{width:`${progress*100}%`}}/></div>
        <div className="mt-1.5 flex items-center justify-between text-[10px] text-neutral-600"><span>{Math.floor(time)}s</span><span>{duration>0?`${Math.ceil(duration)}s`:"Video pre-roll"}</span></div>
        {blocked && <button onClick={() => { const video=videoRef.current;if(!video)return; setBlocked(false); video.muted=false; void video.play().catch(() => setBlocked(true)); }} className="mt-3 w-full rounded-xl bg-amber-400 px-4 py-2 text-sm font-semibold text-black">Play ad to enter livestream</button>}
        <div className="mt-3 text-[10px] text-neutral-600">One video pre-roll per live session. YSong does not insert mid-roll or post-roll video ads into the Room.</div>
      </div>
    </div>
  </div>;
}
