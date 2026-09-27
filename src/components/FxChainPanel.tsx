import { useRef, useState } from "react";
import { browserEffectNames, type BrowserEffectType, type DawTrackEffect } from "../lib/dawEffects";

type Props = {
  trackName: string;
  effects: DawTrackEffect[];
  browserEffectsAvailable: boolean;
  onAddCompressor: () => void;
  onAddBrowserEffect: (type: BrowserEffectType) => void;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onOpen: (id: string) => void;
  onReorder: (from: number, to: number) => void;
  onClose: () => void;
};

export default function FxChainPanel({ trackName, effects, browserEffectsAvailable, onAddCompressor, onAddBrowserEffect, onToggle, onRemove, onOpen, onReorder, onClose }: Props) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const ghostRef = useRef<HTMLElement | null>(null);

  const cleanupGhost = () => {
    if (ghostRef.current) ghostRef.current.remove();
    ghostRef.current = null;
  };

  const dropAt = (targetIndex: number) => {
    if (!draggingId) return;
    const from = effects.findIndex((effect) => effect.id === draggingId);
    if (from < 0) return;
    let to = targetIndex;
    if (to > from) to -= 1;
    if (to !== from) onReorder(from, to);
  };

  return (
    <div className="fixed inset-0 z-[250] flex justify-end" role="dialog" aria-modal="true" aria-label={`${trackName} effects chain`}>
      <button className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" onClick={onClose} aria-label="Close effects chain" />
      <aside className="relative h-full w-[min(420px,94vw)] bg-neutral-950 border-l border-white/10 shadow-2xl flex flex-col">
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.18em] opacity-50">Effects Chain</div>
            <div className="text-sm font-semibold truncate mt-0.5">{trackName}</div>
          </div>
          <button type="button" className="w-9 h-9 rounded-lg hover:bg-white/10" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="px-4 pt-4 text-[11px] opacity-55">Signal flows from top to bottom. Drag or use the arrow buttons to change processing order.</div>
        {!browserEffectsAvailable && <div className="mx-4 mt-3 rounded-lg border border-amber-300/25 bg-amber-300/5 p-3 text-xs text-amber-100/80">Native VST audio supports Dynamics C•1 only. Browser effects saved on this track are unavailable during native playback and export.</div>}
        <div className="px-4 pt-3 text-center text-[10px] tracking-[0.18em] text-cyan-100/55">TRACK INPUT</div>
        <div className="mx-auto my-2 h-5 w-px bg-gradient-to-b from-cyan-300/55 to-white/10" />

        <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
          {effects.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.025] px-4 py-8 text-center text-sm opacity-55">No effects yet.</div>
          ) : (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                if (e.target === e.currentTarget && effects.length) setOverIndex(effects.length);
              }}
              onDrop={(e) => { e.preventDefault(); dropAt(overIndex ?? effects.length); setDraggingId(null); setOverIndex(null); cleanupGhost(); }}
            >
              {effects.map((effect, index) => (
                <div key={effect.id}>
                  <div className={`h-1.5 rounded-full transition ${overIndex === index ? "bg-cyan-300/80" : "bg-transparent"}`} />
                  <div
                    draggable
                    onDragStart={(e) => {
                      setDraggingId(effect.id);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", effect.id);
                      const clone = e.currentTarget.cloneNode(true) as HTMLElement;
                      clone.style.position = "fixed";
                      clone.style.left = "-1000px";
                      clone.style.top = "-1000px";
                      clone.style.width = `${e.currentTarget.getBoundingClientRect().width}px`;
                      clone.style.opacity = "0.58";
                      clone.style.pointerEvents = "none";
                      clone.style.transform = "rotate(1deg)";
                      document.body.appendChild(clone);
                      ghostRef.current = clone;
                      e.dataTransfer.setDragImage(clone, 38, 28);
                    }}
                    onDragEnd={() => { setDraggingId(null); setOverIndex(null); cleanupGhost(); }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const rect = e.currentTarget.getBoundingClientRect();
                      setOverIndex(e.clientY < rect.top + rect.height / 2 ? index : index + 1);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const rect = e.currentTarget.getBoundingClientRect();
                      dropAt(e.clientY < rect.top + rect.height / 2 ? index : index + 1);
                      setDraggingId(null);
                      setOverIndex(null);
                      cleanupGhost();
                    }}
                    className={`group rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.065] to-white/[0.025] p-2.5 cursor-grab active:cursor-grabbing transition ${draggingId === effect.id ? "opacity-45" : "opacity-100"}`}
                  >
                    <div className="flex items-center gap-2">
                      <div className="text-lg opacity-40 select-none" title="Drag to reorder">⠿</div>
                      <div className="w-6 text-[10px] font-mono opacity-40">{String(index + 1).padStart(2, "0")}</div>
                      <button type="button" disabled={effect.type !== "compressor" && !browserEffectsAvailable} className="min-w-0 flex-1 text-left disabled:opacity-60" onClick={() => onOpen(effect.id)}>
                        <div className="text-sm font-semibold truncate">{effect.name}</div>
                        <div className="text-[10px] opacity-45 truncate">{effect.type === "compressor" ? "YSong Compressor" : browserEffectsAvailable ? "Browser audio effect" : "Unavailable on native VST audio"}</div>
                      </button>
                      <button type="button" className={`w-10 h-10 rounded-lg border ${effect.enabled ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-200" : "border-white/10 bg-black/20 opacity-45"}`} onClick={() => onToggle(effect.id)} aria-label={effect.enabled ? "Bypass effect" : "Enable effect"}>⏻</button>
                      <button type="button" disabled={effect.type !== "compressor" && !browserEffectsAvailable} className="w-10 h-10 rounded-lg border border-white/10 hover:bg-white/10 disabled:opacity-30" onClick={() => onOpen(effect.id)} aria-label="Open effect">↗</button>
                      <button type="button" className="w-9 h-9 rounded-lg border border-white/10 hover:bg-rose-400/10 hover:text-rose-200" onClick={() => onRemove(effect.id)} title="Remove effect">✕</button>
                    </div>
                    <div className="mt-2 flex justify-end gap-1 opacity-35 group-hover:opacity-70">
                      <button type="button" disabled={index === 0} className="w-11 h-10 rounded border border-white/10 disabled:opacity-20" onClick={() => index > 0 && onReorder(index, index - 1)} aria-label="Move effect up">↑</button>
                      <button type="button" disabled={index === effects.length - 1} className="w-11 h-10 rounded border border-white/10 disabled:opacity-20" onClick={() => index < effects.length - 1 && onReorder(index, index + 1)} aria-label="Move effect down">↓</button>
                    </div>
                  </div>
                  <div className="mx-auto h-5 w-px bg-white/10" />
                </div>
              ))}
              <div className={`h-1.5 rounded-full transition ${overIndex === effects.length ? "bg-cyan-300/80" : "bg-transparent"}`} />
            </div>
          )}

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" className="min-h-11 rounded-xl border border-cyan-200/20 bg-cyan-300/[0.04] text-sm" onClick={onAddCompressor}>+ Dynamics C•1</button>
            {(Object.keys(browserEffectNames) as BrowserEffectType[]).map((type) => <button key={type} type="button" disabled={!browserEffectsAvailable} className="min-h-11 rounded-xl border border-cyan-200/20 bg-cyan-300/[0.04] text-sm disabled:opacity-30" onClick={() => onAddBrowserEffect(type)}>+ {browserEffectNames[type]}</button>)}
          </div>
          <div className="mx-auto my-2 h-5 w-px bg-gradient-to-b from-white/10 to-cyan-300/55" />
          <div className="text-center text-[10px] tracking-[0.18em] text-cyan-100/55">TRACK OUTPUT</div>
        </div>
      </aside>
    </div>
  );
}
