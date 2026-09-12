import { useEffect, useMemo, useRef, useState } from "react";
import {
  closeRoomPoll,
  createRoomPoll,
  createRoomTrackRequest,
  getRoomVenue,
  moderateRoomTrackRequest,
  publishRoomVenueTransport,
  sendRoomAudienceEffect,
  sendRoomReaction,
  updateRoomVenue,
  voteRoomPoll,
  voteRoomTrackRequest,
  type RoomAudienceEffectId,
  type RoomAudienceEvent,
  type RoomDetail,
  type RoomPoll,
  type RoomTrackRequest,
  type RoomVenueSnapshot,
  type RoomVenueState,
  type RoomVenueTransport,
} from "../lib/roomApi";
import { publishRoomVenueEvent, publishRoomVenueTransportLocal, subscribeRoomVenueEvents } from "../lib/roomVenueRealtime";
import { bridgeApi, type VisualTransportState } from "../lib/bridgeApi";
import { subscribeLocalVisualTransport } from "../lib/visualsRealtime";
import { fetchWorldTrack } from "../lib/worldApi";
import { useWorldPlayer } from "./WorldPlayer";

const EFFECTS: Array<{ id: RoomAudienceEffectId; label: string; icon: string }> = [
  { id: "applause", label: "Applause", icon: "👏" },
  { id: "hearts", label: "Hearts", icon: "💜" },
  { id: "confetti", label: "Confetti", icon: "🎉" },
  { id: "lightning", label: "Lightning", icon: "⚡" },
  { id: "fire", label: "Fire", icon: "🔥" },
  { id: "snow", label: "Snow", icon: "❄️" },
  { id: "camera-shake", label: "Camera Shake", icon: "📳" },
  { id: "strobe", label: "Strobe", icon: "✨" },
];

const REACTIONS = ["❤️", "🔥", "⚡", "👏", "😂", "🤯"];

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function venueTransportFromVisual(state: VisualTransportState): RoomVenueTransport {
  return {
    source: state?.source === "world" || state?.source === "daw" ? state.source : "none",
    playing: !!state?.playing,
    positionSeconds: Math.max(0, Number(state?.positionSeconds) || 0),
    durationSeconds: Math.max(0, Number(state?.durationSeconds) || 0),
    trackId: state?.trackId ? String(state.trackId) : undefined,
    title: state?.title ? String(state.title) : undefined,
    artist: state?.artist ? String(state.artist) : undefined,
    album: state?.album ? String(state.album) : undefined,
    broadcastProgramId: state?.broadcastProgramId ? String(state.broadcastProgramId) : undefined,
    broadcastProgramName: state?.broadcastProgramName ? String(state.broadcastProgramName) : undefined,
    broadcastKind: state?.broadcastKind === "radio" || state?.broadcastKind === "playlist" ? state.broadcastKind : "ad-hoc",
    visualSceneId: state?.visualSceneId ? String(state.visualSceneId) : undefined,
    visualSceneName: state?.visualSceneName ? String(state.visualSceneName) : undefined,
    nextTrackId: state?.nextTrackId ? String(state.nextTrackId) : undefined,
    nextTitle: state?.nextTitle ? String(state.nextTitle) : undefined,
    nextArtist: state?.nextArtist ? String(state.nextArtist) : undefined,
    adBreakActive: !!state?.adBreakActive,
    updatedAt: Number(state?.updatedAt) || Date.now(),
  };
}

function formatTime(seconds: number) {
  const value = Math.max(0, Number(seconds) || 0);
  const m = Math.floor(value / 60);
  const s = Math.floor(value % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function elapsedTransportPosition(transport: RoomVenueTransport | null, now = Date.now()) {
  if (!transport) return 0;
  const base = Math.max(0, Number(transport.positionSeconds) || 0);
  if (!transport.playing || !transport.updatedAt) return Math.min(base, transport.durationSeconds || base);
  const drift = Math.max(0, Math.min(4, (now - transport.updatedAt) / 1000));
  const next = base + drift;
  return transport.durationSeconds > 0 ? Math.min(next, transport.durationSeconds) : next;
}

function eventLabel(event: RoomAudienceEvent) {
  if (event.kind === "reaction") return `${event.actorName} ${String(event.payload?.emoji || "reacted")}`;
  if (event.kind === "effect") return `${event.actorName} triggered ${String(event.payload?.effectId || "an effect")}`;
  const type = String(event.payload?.type || "room-event");
  if (type === "venue-started") return `Stage went live`;
  if (type === "venue-ended") return `Stage ended`;
  if (type === "track-request") return `${event.actorName} requested ${String(event.payload?.title || "a song")}`;
  if (type === "poll-started") return `Vote opened: ${String(event.payload?.question || "Poll")}`;
  if (type === "poll-closed") return `Vote closed`;
  return type.replace(/-/g, " ");
}

function mergeEvents(current: RoomAudienceEvent[], incoming: RoomAudienceEvent[]) {
  const byId = new Map(current.map((event) => [event.id, event]));
  for (const event of incoming) byId.set(event.id, event);
  return [...byId.values()].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()).slice(-80);
}

export default function RoomVenuePanel({ detail, meUserId }: { detail: RoomDetail; meUserId?: string }) {
  const room = detail.room;
  const [snapshot, setSnapshot] = useState<RoomVenueSnapshot | null>(null);
  const [events, setEvents] = useState<RoomAudienceEvent[]>([]);
  const [requests, setRequests] = useState<RoomTrackRequest[]>([]);
  const [poll, setPoll] = useState<RoomPoll | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [requestTitle, setRequestTitle] = useState("");
  const [requestArtist, setRequestArtist] = useState("");
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollOptions, setPollOptions] = useState("Yes\nNo");
  const [effectCooldownUntil, setEffectCooldownUntil] = useState(0);
  const [followStage, setFollowStage] = useState(false);
  const [now, setNow] = useState(Date.now());
  const lastEventAtRef = useRef("");
  const publishBusyRef = useRef(false);
  const lastPublishedAtRef = useRef(0);
  const lastSyncedTrackRef = useRef("");
  const forwardedEffectIdsRef = useRef(new Set<string>());
  const { current, playing, audioRef, startQueue, seek, pause, toggle } = useWorldPlayer();

  const venue = snapshot?.venue || null;
  const isAdmin = room.role === "owner" || room.role === "admin";
  const isHost = !!venue?.active && venue.hostUserId === meUserId;
  const transport = venue?.transport || null;
  const position = elapsedTransportPosition(transport, now);
  const progress = transport?.durationSeconds ? Math.max(0, Math.min(1, position / transport.durationSeconds)) : 0;

  async function loadVenue(initial = false) {
    try {
      const data = await getRoomVenue(room.id, initial ? undefined : lastEventAtRef.current || undefined);
      setSnapshot(data);
      setRequests(data.requests || []);
      setPoll(data.poll || null);
      if (data.events?.length) {
        setEvents((prev) => mergeEvents(initial ? [] : prev, data.events));
        for (const event of data.events) publishRoomVenueEvent(room.id, event);
        const newest = data.events[data.events.length - 1];
        if (newest?.createdAt) lastEventAtRef.current = newest.createdAt;
      } else if (initial) setEvents([]);
      if (data.venue?.transport) publishRoomVenueTransportLocal(room.id, data.venue.transport);
      setError("");
    } catch (error: unknown) {
      if (initial) setError(errorMessage(error, "Could not load live stage."));
    }
  }

  useEffect(() => {
    lastEventAtRef.current = "";
    setSnapshot(null); setEvents([]); setRequests([]); setPoll(null); setFollowStage(false); lastSyncedTrackRef.current = "";
    void loadVenue(true);
    const timer = window.setInterval(() => void loadVenue(false), 1500);
    return () => window.clearInterval(timer);
  }, [room.id]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    forwardedEffectIdsRef.current.clear();
    if (!isHost || !venue?.active) return;
    return subscribeRoomVenueEvents((roomId, event) => {
      if (roomId !== room.id || event.kind !== "effect" || !event.id || forwardedEffectIdsRef.current.has(event.id)) return;
      const effectId = String(event.payload?.effectId || "") as RoomAudienceEffectId;
      if (!EFFECTS.some((entry) => entry.id === effectId)) return;
      forwardedEffectIdsRef.current.add(event.id);
      if (forwardedEffectIdsRef.current.size > 128) {
        const first = forwardedEffectIdsRef.current.values().next().value;
        if (first) forwardedEffectIdsRef.current.delete(first);
      }
      void bridgeApi.pushVisualRoomEffect({
        roomId: room.id,
        eventId: event.id,
        effectId,
        actorName: event.actorName || "Audience",
        timestampUnixMs: Date.now(),
      }).catch(() => {});
    });
  }, [isHost, room.id, venue?.active]);

  useEffect(() => {
    if (!isHost || !venue?.active) return;
    return subscribeLocalVisualTransport((state) => {
      const currentNow = Date.now();
      if (publishBusyRef.current || currentNow - lastPublishedAtRef.current < 300) return;
      publishBusyRef.current = true;
      const next = venueTransportFromVisual(state);
      publishRoomVenueTransportLocal(room.id, next);
      void publishRoomVenueTransport(room.id, next).then((result) => {
        if (result?.venue) setSnapshot((prev) => prev ? { ...prev, venue: result.venue } : prev);
        lastPublishedAtRef.current = Date.now();
      }).catch(() => {}).finally(() => { publishBusyRef.current = false; });
    });
  }, [isHost, room.id, venue?.active]);

  useEffect(() => {
    if (!followStage || isHost || !venue?.active || !transport?.trackId || transport.adBreakActive) return;
    const sync = async () => {
      try {
        if (lastSyncedTrackRef.current !== transport.trackId || current?.id !== transport.trackId) {
          const result = await fetchWorldTrack(transport.trackId!);
          if (!result.track) return;
          lastSyncedTrackRef.current = transport.trackId!;
          startQueue([result.track], `${room.name} · Live Stage`, result.track.id, "", "", "ad-hoc");
          window.setTimeout(() => {
            seek(elapsedTransportPosition(transport));
            if (!transport.playing) pause();
          }, 220);
          return;
        }
        const localPosition = Number(audioRef.current?.currentTime || 0);
        const target = elapsedTransportPosition(transport);
        if (Math.abs(localPosition - target) > 1.25) seek(target);
        if (transport.playing && !playing) toggle();
        if (!transport.playing && playing) pause();
      } catch { /* Stage audio sync is best effort. */ }
    };
    void sync();
  }, [followStage, isHost, venue?.active, transport?.trackId, transport?.playing, transport?.positionSeconds, transport?.updatedAt, transport?.adBreakActive]);

  async function patchVenue(patch: Partial<RoomVenueState>) {
    if (!isAdmin) return;
    setBusy(true); setError("");
    try {
      const result = await updateRoomVenue(room.id, patch);
      setSnapshot((prev) => prev ? { ...prev, venue: result.venue } : { venue: result.venue, events: [], requests: [], poll: null, serverNow: Date.now() });
    } catch (error: unknown) { setError(errorMessage(error, "Could not update live stage.")); }
    finally { setBusy(false); }
  }

  async function react(emoji: string) {
    try {
      const result = await sendRoomReaction(room.id, emoji);
      setEvents((prev) => mergeEvents(prev, [result.event]));
      publishRoomVenueEvent(room.id, result.event);
    } catch (error: unknown) { setError(errorMessage(error, "Could not react.")); }
  }

  async function triggerEffect(effectId: RoomAudienceEffectId) {
    if (Date.now() < effectCooldownUntil) return;
    try {
      const result = await sendRoomAudienceEffect(room.id, effectId);
      setEvents((prev) => mergeEvents(prev, [result.event]));
      publishRoomVenueEvent(room.id, result.event);
      setEffectCooldownUntil(Date.now() + Math.max(1, result.cooldownRemainingSeconds || venue?.effectCooldownSeconds || 12) * 1000);
    } catch (error: unknown) {
      const message = errorMessage(error, "Could not trigger audience effect.");
      setError(message === "effect_cooldown" ? "Audience effect is cooling down." : message);
    }
  }

  async function submitRequest() {
    if (!requestTitle.trim()) return;
    setBusy(true);
    try {
      const result = await createRoomTrackRequest(room.id, { title: requestTitle.trim(), artist: requestArtist.trim() });
      setRequests((prev) => [...prev, result.request]); setRequestTitle(""); setRequestArtist("");
    } catch (error: unknown) { setError(errorMessage(error, "Could not send request.")); }
    finally { setBusy(false); }
  }

  async function voteRequest(request: RoomTrackRequest) {
    try {
      const result = await voteRoomTrackRequest(room.id, request.id);
      if (result.request) setRequests((prev) => prev.map((item) => item.id === request.id ? result.request : item));
    } catch (error: unknown) { setError(errorMessage(error, "Could not vote.")); }
  }

  async function moderateRequest(request: RoomTrackRequest, status: RoomTrackRequest["status"]) {
    try {
      await moderateRoomTrackRequest(room.id, request.id, status);
      if (status === "rejected" || status === "played") setRequests((prev) => prev.filter((item) => item.id !== request.id));
      else setRequests((prev) => prev.map((item) => item.id === request.id ? { ...item, status } : item));
    } catch (error: unknown) { setError(errorMessage(error, "Could not moderate request.")); }
  }

  async function createPoll() {
    const options = pollOptions.split(/\r?\n/).map((x) => x.trim()).filter(Boolean).slice(0, 8);
    if (!pollQuestion.trim() || options.length < 2) { setError("Poll needs a question and at least two options."); return; }
    try {
      const result = await createRoomPoll(room.id, pollQuestion.trim(), options, 0);
      setPoll(result.poll); setPollQuestion("");
    } catch (error: unknown) { setError(errorMessage(error, "Could not create poll.")); }
  }

  async function castPollVote(activePoll: RoomPoll, optionId: string) {
    try { const result = await voteRoomPoll(room.id, activePoll.id, optionId); setPoll(result.poll); }
    catch (error: unknown) { setError(errorMessage(error, "Could not vote.")); }
  }

  async function endPoll(activePoll: RoomPoll) {
    try { await closeRoomPoll(room.id, activePoll.id); setPoll(null); }
    catch (error: unknown) { setError(errorMessage(error, "Could not close poll.")); }
  }

  const cooldown = Math.max(0, Math.ceil((effectCooldownUntil - now) / 1000));
  const stageName = venue?.stageTitle || room.name;
  const stageSubtitle = venue?.stageSubtitle || (venue?.mode === "performance" ? "Live Performance" : venue?.mode === "visual" ? "Visual Broadcast" : venue?.mode === "radio" ? "Radio Room" : "Listening Room");
  const recentEvents = useMemo(() => events.slice(-10).reverse(), [events]);

  if (!venue) return <div className="border-b border-neutral-200 dark:border-neutral-800 px-4 py-3 text-xs opacity-50">Loading Room stage…</div>;

  return <div className="shrink-0 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-950/95 text-white">
    <div className="mx-auto max-w-[1180px] p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0"><div className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${venue.active ? "bg-red-500 shadow-[0_0_10px_rgba(239,68,68,.8)]" : "bg-neutral-600"}`}/><span className="text-[10px] font-bold uppercase tracking-[.18em] text-neutral-500">{venue.active ? "Live Venue" : "Room Stage"}</span>{venue.active && <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-.5 text-[9px] font-semibold text-red-300">LIVE</span>}</div><div className="mt-1 truncate text-sm font-semibold">{stageName}</div><div className="truncate text-[10px] text-neutral-500">{stageSubtitle}{venue.hostName ? ` · hosted by ${venue.hostName}` : ""}</div></div>
        <div className="flex flex-wrap gap-2">{isAdmin && <>{venue.active ? <button disabled={busy} onClick={() => void patchVenue({ active:false })} className="rounded-lg border border-red-500/30 px-3 py-1.5 text-xs text-red-300">End Live Stage</button> : <button disabled={busy} onClick={() => void patchVenue({ active:true, stageTitle: venue.stageTitle || room.name })} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold">Go Live</button>}</>}{venue.active && !isHost && transport?.trackId && <button onClick={() => setFollowStage((value) => !value)} className={`rounded-lg border px-3 py-1.5 text-xs ${followStage ? "border-cyan-400/40 bg-cyan-500/10 text-cyan-200" : "border-neutral-700 text-neutral-300"}`}>{followStage ? "✓ Synced Audio" : "Sync Audio"}</button>}</div>
      </div>

      {venue.active && <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1.65fr)_minmax(280px,.75fr)]">
        <div className="overflow-hidden rounded-xl border border-neutral-800 bg-black">
          {venue.streamMode === "embed" && venue.streamUrl ? <div className="relative aspect-video"><iframe src={venue.streamUrl} title={venue.streamLabel || stageName} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen className="absolute inset-0 h-full w-full border-0"/></div> : isHost ? <div className="relative aspect-video"><iframe src="/visual-output?embedded=1&program=1" title="YSong Program Output room preview" className="absolute inset-0 h-full w-full border-0"/><div className="pointer-events-none absolute left-2 top-2 rounded bg-black/70 px-2 py-1 text-[9px] uppercase tracking-wider text-neutral-400">Local Program Output · Host Preview</div></div> : <div className="grid aspect-video place-items-center bg-gradient-to-br from-neutral-950 via-neutral-900 to-black p-8 text-center"><div><div className="text-5xl">🎛️</div><div className="mt-3 text-sm font-semibold">Live YSong Stage</div><div className="mt-1 max-w-md text-xs leading-relaxed text-neutral-500">The host is sharing synchronized music and stage metadata. For remote video, the host can attach an embeddable livestream URL. Internal YSong video distribution is not faked here.</div></div></div>}
          <div className="border-t border-neutral-800 p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="truncate text-sm font-semibold">{transport?.adBreakActive ? "Radio Ad Break" : transport?.title || "Waiting for the host…"}</div><div className="truncate text-xs text-neutral-500">{transport?.adBreakActive ? "Audio radio break" : [transport?.artist, transport?.album].filter(Boolean).join(" · ") || transport?.broadcastProgramName || "No transport published yet"}</div>{transport?.visualSceneName && <div className="mt-1 truncate text-[9px] uppercase tracking-wider text-violet-400/70">Visual: {transport.visualSceneName}</div>}</div><div className="shrink-0 font-mono text-[10px] text-neutral-500">{formatTime(position)} / {formatTime(transport?.durationSeconds || 0)}</div></div><div className="mt-2 h-1 overflow-hidden rounded bg-neutral-800"><div className="h-full bg-violet-500 transition-[width] duration-200" style={{width:`${progress*100}%`}}/></div>{transport?.nextTitle && <div className="mt-2 text-[10px] text-neutral-600">Up next: {transport.nextTitle}{transport.nextArtist ? ` · ${transport.nextArtist}` : ""}</div>}</div>
        </div>

        <div className="space-y-3">
          <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-3"><div className="text-[10px] font-bold uppercase tracking-[.16em] text-neutral-500">Audience</div><div className="mt-2 flex flex-wrap gap-1.5">{REACTIONS.map((emoji) => <button key={emoji} onClick={() => void react(emoji)} className="rounded-lg border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 text-lg hover:border-violet-500/40">{emoji}</button>)}</div>{venue.audienceEffectsEnabled && <><div className="mt-3 flex items-center justify-between"><div className="text-[10px] font-bold uppercase tracking-[.16em] text-neutral-600">Stage effects</div><div className="text-[9px] text-neutral-600">{cooldown ? `${cooldown}s cooldown` : `${venue.effectCooldownSeconds}s per viewer`}</div></div><div className="mt-2 grid grid-cols-4 gap-1">{EFFECTS.map((effect) => <button key={effect.id} disabled={cooldown>0} onClick={() => void triggerEffect(effect.id)} title={effect.label} className="rounded-lg border border-neutral-800 bg-neutral-900 px-1 py-2 text-lg disabled:opacity-30">{effect.icon}</button>)}</div></>}</div>
          <div className="max-h-36 overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-950 p-3"><div className="text-[10px] font-bold uppercase tracking-[.16em] text-neutral-500">Live activity</div><div className="mt-2 space-y-1">{recentEvents.length ? recentEvents.map((event) => <div key={event.id} className="truncate text-[10px] text-neutral-500">{eventLabel(event)}</div>) : <div className="text-[10px] text-neutral-700">Audience reactions appear here.</div>}</div></div>
        </div>
      </div>}

      {isAdmin && <details className="mt-3 rounded-xl border border-neutral-800 bg-neutral-950/80 p-3"><summary className="cursor-pointer text-xs font-semibold text-neutral-300">Venue Controls</summary><div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4"><label className="text-[10px] text-neutral-500">Mode<select value={venue.mode} onChange={(e) => void patchVenue({mode:e.target.value as RoomVenueState["mode"]})} className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-2 text-xs"><option value="listening">Listening Room</option><option value="radio">Radio Room</option><option value="visual">Visual Broadcast</option><option value="performance">Live Performance</option></select></label><label className="text-[10px] text-neutral-500">Stage title<input value={venue.stageTitle} onChange={(e)=>setSnapshot(prev=>prev?{...prev,venue:{...prev.venue,stageTitle:e.target.value}}:prev)} onBlur={(e)=>void patchVenue({stageTitle:e.target.value})} className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-2 text-xs"/></label><label className="text-[10px] text-neutral-500">Subtitle<input value={venue.stageSubtitle} onChange={(e)=>setSnapshot(prev=>prev?{...prev,venue:{...prev.venue,stageSubtitle:e.target.value}}:prev)} onBlur={(e)=>void patchVenue({stageSubtitle:e.target.value})} className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-2 text-xs"/></label><label className="text-[10px] text-neutral-500">Effect cooldown<input type="number" min={1} max={600} value={venue.effectCooldownSeconds} onChange={(e)=>void patchVenue({effectCooldownSeconds:Number(e.target.value)||12})} className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-2 text-xs"/></label></div><div className="mt-3 grid gap-2 sm:grid-cols-3"><label className="flex items-center gap-2 rounded-lg border border-neutral-800 p-2 text-xs"><input type="checkbox" checked={venue.requestsEnabled} onChange={(e)=>void patchVenue({requestsEnabled:e.target.checked})}/> Song requests</label><label className="flex items-center gap-2 rounded-lg border border-neutral-800 p-2 text-xs"><input type="checkbox" checked={venue.votesEnabled} onChange={(e)=>void patchVenue({votesEnabled:e.target.checked})}/> Audience voting</label><label className="flex items-center gap-2 rounded-lg border border-neutral-800 p-2 text-xs"><input type="checkbox" checked={venue.audienceEffectsEnabled} onChange={(e)=>void patchVenue({audienceEffectsEnabled:e.target.checked})}/> Audience stage effects</label></div><div className="mt-3 grid gap-3 md:grid-cols-[180px_minmax(0,1fr)_220px]"><label className="text-[10px] text-neutral-500">Remote video<select value={venue.streamMode} onChange={(e)=>void patchVenue({streamMode:e.target.value as RoomVenueState["streamMode"]})} className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-2 text-xs"><option value="none">No embedded stream</option><option value="embed">Embed livestream URL</option></select></label><label className="text-[10px] text-neutral-500">Embeddable stream URL<input value={venue.streamUrl} disabled={venue.streamMode!=="embed"} onChange={(e)=>setSnapshot(prev=>prev?{...prev,venue:{...prev.venue,streamUrl:e.target.value}}:prev)} onBlur={(e)=>void patchVenue({streamUrl:e.target.value})} placeholder="https://…/embed/…" className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-2 text-xs disabled:opacity-30"/></label><label className="text-[10px] text-neutral-500">Stream label<input value={venue.streamLabel} disabled={venue.streamMode!=="embed"} onChange={(e)=>setSnapshot(prev=>prev?{...prev,venue:{...prev.venue,streamLabel:e.target.value}}:prev)} onBlur={(e)=>void patchVenue({streamLabel:e.target.value})} className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-2 text-xs disabled:opacity-30"/></label></div><div className="mt-2 text-[9px] leading-relaxed text-neutral-600">Host preview uses the same local YSong Program Output that OBS sees. Remote video currently uses an embeddable livestream URL; synchronized Room transport, chat, reactions, requests and voting remain native YSong features.</div></details>}

      {venue.active && (venue.requestsEnabled || venue.votesEnabled) && <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {venue.requestsEnabled && <div className="rounded-xl border border-neutral-800 bg-neutral-950/80 p-3"><div className="flex items-center justify-between"><div className="text-[10px] font-bold uppercase tracking-[.16em] text-neutral-500">Song Requests</div><div className="text-[9px] text-neutral-600">{requests.length} active</div></div><div className="mt-2 grid grid-cols-[1fr_1fr_auto] gap-1"><input value={requestTitle} onChange={(e)=>setRequestTitle(e.target.value)} placeholder="Song title" className="min-w-0 rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-xs"/><input value={requestArtist} onChange={(e)=>setRequestArtist(e.target.value)} placeholder="Artist" className="min-w-0 rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-xs"/><button disabled={busy||!requestTitle.trim()} onClick={()=>void submitRequest()} className="rounded-lg bg-violet-600 px-3 text-xs disabled:opacity-30">Request</button></div><div className="mt-2 max-h-40 space-y-1 overflow-y-auto">{requests.map((request)=><div key={request.id} className="flex items-center gap-2 rounded-lg border border-neutral-800 px-2 py-1.5"><button disabled={!venue.votesEnabled} onClick={()=>void voteRequest(request)} className={`rounded px-2 py-1 text-[10px] ${request.myVote?"bg-violet-500/20 text-violet-200":"bg-neutral-900 text-neutral-500"}`}>▲ {request.votes}</button><div className="min-w-0 flex-1"><div className="truncate text-xs">{request.title}</div><div className="truncate text-[9px] text-neutral-600">{request.artist||"Unknown artist"} · {request.requesterName} · {request.status}</div></div>{isAdmin&&<div className="flex gap-1"><button onClick={()=>void moderateRequest(request,"approved")} className="rounded border border-emerald-500/20 px-1.5 py-1 text-[9px] text-emerald-300">✓</button><button onClick={()=>void moderateRequest(request,"played")} className="rounded border border-cyan-500/20 px-1.5 py-1 text-[9px] text-cyan-300">Played</button><button onClick={()=>void moderateRequest(request,"rejected")} className="rounded border border-red-500/20 px-1.5 py-1 text-[9px] text-red-300">×</button></div>}</div>)}</div></div>}
        {venue.votesEnabled && <div className="rounded-xl border border-neutral-800 bg-neutral-950/80 p-3"><div className="text-[10px] font-bold uppercase tracking-[.16em] text-neutral-500">Audience Vote</div>{poll?<div className="mt-2"><div className="text-sm font-semibold">{poll.question}</div><div className="mt-2 space-y-1">{poll.options.map((option)=><button key={option.id} onClick={()=>void castPollVote(poll,option.id)} className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-xs ${poll.myOptionId===option.id?"border-violet-500/40 bg-violet-500/10":"border-neutral-800"}`}><span>{option.label}</span><span className="text-neutral-500">{option.votes}</span></button>)}</div>{isAdmin&&<button onClick={()=>void endPoll(poll)} className="mt-2 rounded-lg border border-neutral-700 px-2 py-1 text-[10px] text-neutral-400">Close vote</button>}</div>:isAdmin?<div className="mt-2"><input value={pollQuestion} onChange={(e)=>setPollQuestion(e.target.value)} placeholder="Question" className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-xs"/><textarea value={pollOptions} onChange={(e)=>setPollOptions(e.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-xs" placeholder="One option per line"/><button onClick={()=>void createPoll()} className="mt-1 rounded-lg bg-violet-600 px-3 py-1.5 text-xs">Open Vote</button></div>:<div className="mt-3 text-xs text-neutral-600">No vote is open.</div>}</div>}
      </div>}
      {error && <div className="mt-2 text-[10px] text-red-400">{error}</div>}
    </div>
  </div>;
}
