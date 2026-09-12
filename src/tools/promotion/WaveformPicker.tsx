import { useEffect, useMemo, useRef, useState } from "react";

const MIN_CLIP = 5;
const MAX_CLIP = 60;

function fmt(seconds:number){
  const s=Math.max(0,seconds||0); const m=Math.floor(s/60); const rest=s-m*60;
  return `${m}:${rest.toFixed(1).padStart(4,"0")}`;
}

export default function WaveformPicker({audioUrl,durationHint=0,start,duration,onChange}:{audioUrl:string;durationHint?:number;start:number;duration:number;onChange:(start:number,duration:number)=>void}){
  const [peaks,setPeaks]=useState<number[]>([]); const [decodedDuration,setDecodedDuration]=useState(0); const [loading,setLoading]=useState(false); const audioRef=useRef<HTMLAudioElement|null>(null); const dragAnchor=useRef<number|null>(null);
  const total=Math.max(decodedDuration,durationHint,MIN_CLIP); const safeDuration=Math.max(MIN_CLIP,Math.min(MAX_CLIP,duration,total)); const safeStart=Math.max(0,Math.min(start,Math.max(0,total-safeDuration)));
  const selectionLeft=(safeStart/total)*100; const selectionWidth=(safeDuration/total)*100;

  useEffect(()=>{
    let cancelled=false; if(!audioUrl){setPeaks([]);setDecodedDuration(0);return;}
    setLoading(true);
    (async()=>{
      try{
        const response=await fetch(audioUrl); const buf=await response.arrayBuffer(); const Ctx=window.AudioContext||((window as unknown as {webkitAudioContext?:typeof AudioContext}).webkitAudioContext); if(!Ctx) return;
        const ctx=new Ctx(); const decoded=await ctx.decodeAudioData(buf.slice(0)); const data=decoded.getChannelData(0); const buckets=420; const step=Math.max(1,Math.floor(data.length/buckets)); const next:number[]=[];
        for(let i=0;i<buckets;i++){let max=0;const from=i*step,to=Math.min(data.length,from+step);for(let j=from;j<to;j++)max=Math.max(max,Math.abs(data[j]||0));next.push(max);} await ctx.close(); if(!cancelled){setPeaks(next);setDecodedDuration(decoded.duration||0);}
      }catch{ if(!cancelled)setPeaks([]); }finally{if(!cancelled)setLoading(false);}
    })();
    return()=>{cancelled=true;};
  },[audioUrl]);

  useEffect(()=>{ if(total>0&&(safeStart!==start||safeDuration!==duration))onChange(safeStart,safeDuration); },[total]); // eslint-disable-line react-hooks/exhaustive-deps

  const bars=useMemo(()=>peaks.map((v,i)=>{const h=Math.max(2,Math.round(v*92));return <rect key={i} x={`${(i/Math.max(1,peaks.length))*100}%`} y={`${50-h/2}%`} width={`${100/Math.max(1,peaks.length)*.72}%`} height={`${h}%`} rx=".15" className="fill-neutral-400/65 dark:fill-neutral-500/70"/>;}),[peaks]);

  function xToTime(e:React.PointerEvent<SVGSVGElement>){const r=e.currentTarget.getBoundingClientRect();return Math.max(0,Math.min(total,((e.clientX-r.left)/Math.max(1,r.width))*total));}
  function pointerDown(e:React.PointerEvent<SVGSVGElement>){e.currentTarget.setPointerCapture(e.pointerId);const t=xToTime(e);dragAnchor.current=t;const d=Math.min(MAX_CLIP,Math.max(MIN_CLIP,Math.min(safeDuration,total)));onChange(Math.min(t,Math.max(0,total-d)),d);}
  function pointerMove(e:React.PointerEvent<SVGSVGElement>){if(dragAnchor.current===null)return;const a=dragAnchor.current,b=xToTime(e);let s=Math.min(a,b),d=Math.abs(b-a);d=Math.max(MIN_CLIP,Math.min(MAX_CLIP,d));if(s+d>total)s=Math.max(0,total-d);onChange(s,d);}
  function pointerUp(){dragAnchor.current=null;}
  function preview(){const a=audioRef.current;if(!a)return;a.currentTime=safeStart;void a.play();}

  return <div className="rounded-2xl border border-neutral-200 bg-neutral-50/70 p-4 dark:border-neutral-800 dark:bg-neutral-950/40">
    <div className="flex items-center justify-between gap-3"><div><div className="text-sm font-semibold">Choose the song section</div><div className="text-xs text-neutral-500">Drag across the waveform. Clips can be 5–60 seconds.</div></div><button onClick={preview} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs dark:border-neutral-700">▶ Preview clip</button></div>
    <div className="relative mt-4 h-32 overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
      {loading&&<div className="absolute inset-0 z-20 grid place-items-center text-xs text-neutral-500">Building waveform…</div>}
      <svg className="h-full w-full touch-none select-none" viewBox="0 0 100 100" preserveAspectRatio="none" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}>
        {bars}
        <rect x={`${selectionLeft}%`} y="0" width={`${selectionWidth}%`} height="100" className="fill-violet-500/20 stroke-violet-500" vectorEffect="non-scaling-stroke"/>
      </svg>
    </div>
    <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-[11px] text-neutral-500">Start · {fmt(safeStart)}<input className="mt-1 w-full" type="range" min={0} max={Math.max(0,total-safeDuration)} step={.1} value={safeStart} onChange={e=>onChange(Number(e.target.value),safeDuration)}/></label><label className="text-[11px] text-neutral-500">Length · {safeDuration.toFixed(1)} sec<input className="mt-1 w-full" type="range" min={MIN_CLIP} max={Math.max(MIN_CLIP,Math.min(MAX_CLIP,total-safeStart))} step={.1} value={safeDuration} onChange={e=>onChange(safeStart,Number(e.target.value))}/></label></div>
    <audio ref={audioRef} src={audioUrl} preload="metadata" onTimeUpdate={e=>{if(e.currentTarget.currentTime>=safeStart+safeDuration)e.currentTarget.pause();}} className="mt-3 h-9 w-full" controls/>
  </div>;
}
