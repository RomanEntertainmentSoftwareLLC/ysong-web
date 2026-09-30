import { useEffect, useRef, useState } from "react";
import { worldAudioUrl } from "../../lib/worldApi";
import { fetchGenreCatalog } from "../musicseo/api/musicIntelClient";
import {
  getAudioIntelligenceCapabilities,
  startAudioIntelligence,
  uploadForAudioIntelligence,
  waitForLocalJob,
  type AudioIntelligenceReport,
} from "../audiointelligence/api";
import { genresFromAudioReport, type AdsGenreResult } from "./adsGenreResult";

type Props = {
  file?: File | null;
  trackId?: string;
  sourceName?: string;
  initialResult?: AdsGenreResult | null;
  onResult: (result: AdsGenreResult) => void;
  onTiming?: (timing: AdsGenreResult["tempo"]) => void;
};

export default function AdsGenreAnalysis({ file, trackId, sourceName, initialResult = null, onResult, onTiming }: Props) {
  const [result, setResult] = useState<AdsGenreResult | null>(initialResult);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  async function analyze() {
    if ((!file && !trackId) || busy) return;
    const current = new AbortController();
    controller.current = current;
    setBusy(true);
    setError("");
    setProgress("Checking YSong Audio Intelligence");
    try {
      const capabilities = await getAudioIntelligenceCapabilities();
      if (!capabilities.available) throw new Error(capabilities.reason || "YSong Audio Intelligence is unavailable.");
      let source = file;
      if (!source && trackId) {
        setProgress("Preparing selected song");
        const response = await fetch(worldAudioUrl(trackId), { credentials: "include", signal: current.signal });
        if (!response.ok) throw new Error(`Could not load the selected song (${response.status}).`);
        const blob = await response.blob();
        const extension = sourceName?.split(".").pop()?.toLowerCase();
        const allowed = ["mp3", "wav", "aac", "m4a", "ogg", "flac"];
        const mimeExtension: Record<string, string> = { "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/aac": "aac", "audio/mp4": "m4a", "audio/ogg": "ogg", "audio/flac": "flac" };
        const suffix = extension && allowed.includes(extension) ? extension : mimeExtension[blob.type] || "mp3";
        source = new File([blob], `${trackId}.${suffix}`, { type: blob.type || "audio/mpeg" });
      }
      if (!source || current.signal.aborted) return;
      setProgress("Preparing audio");
      const upload = await uploadForAudioIntelligence(source);
      if (current.signal.aborted) return;
      setProgress("Analyzing genres");
      const started = await startAudioIntelligence(upload.asset_id, {});
      const finished = await waitForLocalJob(started.job_id, job => {
        if (!current.signal.aborted) setProgress(`Analyzing genres · ${job.progress_percent || 0}%`);
      }, current.signal);
      const report = finished.result?.report as AudioIntelligenceReport | undefined;
      if (!report?.genre?.candidates) throw new Error("Audio Intelligence completed without genre results.");
      const classified = genresFromAudioReport(report);
      if (!current.signal.aborted) onTiming?.(classified.tempo);
      const labels = [classified.primary, classified.secondary, ...classified.related]
        .filter((value): value is string => Boolean(value));
      setProgress("Matching YSong genre Atlas");
      const matches = await Promise.all(labels.map(async label => {
        const catalog = await fetchGenreCatalog(label, 20);
        return catalog.entries.find(entry => entry.genre.toLowerCase() === label.toLowerCase())?.genre || null;
      }));
      const verified = [...new Set(matches.filter((value): value is string => Boolean(value)))];
      if (!verified.length) throw new Error("Audio genres did not match the YSong genre Atlas. Try another recording or analyze again later.");
      const next: AdsGenreResult = {
        ...classified,
        primary: verified[0],
        secondary: verified[1] || null,
        related: verified.slice(2),
      };
      if (current.signal.aborted) return;
      setResult(next);
      onResult(next);
    } catch (cause) {
      if (!current.signal.aborted) setError(cause instanceof Error ? cause.message : "Genre analysis failed.");
    } finally {
      if (!current.signal.aborted) { setBusy(false); setProgress(""); }
    }
  }

  return <div className="mt-4 rounded-xl border border-violet-500/25 bg-violet-500/5 p-3 text-xs">
    <div className="font-semibold">YSong Audio Intelligence · genre analysis</div>
    <p className="mt-1 text-neutral-500">Analyze the audio with YSong Audio Intelligence, then match its ranked labels to the 6,000+ genre Atlas. Results suggest audience searches.</p>
    <button type="button" disabled={busy || (!file && !trackId)} onClick={() => void analyze()} className="mt-3 rounded-lg border border-violet-500/40 px-3 py-2 font-medium text-violet-600 disabled:opacity-40 dark:text-violet-300">{busy ? progress : result ? "Analyze again" : "Analyze genres"}</button>
    {error && <p role="alert" className="mt-2 text-red-500">{error}</p>}
    {result && <div className="mt-3 space-y-1 text-neutral-700 dark:text-neutral-200">
      <div><b>Primary:</b> {result.primary}{result.family && result.family !== result.primary ? ` · ${result.family} family` : ""}</div>
      <div><b>Secondary:</b> {result.secondary || "No secondary result"}</div>
      <div><b>Related:</b> {result.related.length ? result.related.join(" · ") : "No related results"}</div>
      <p className="pt-1 text-neutral-500">Choose any audience interests yourself. Genre results do not set targeting.</p>
    </div>}
  </div>;
}
