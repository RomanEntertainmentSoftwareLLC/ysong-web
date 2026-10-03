import { useEffect, useState } from "react";
import { fetchReleaseCandidates, linkArtistReleases, type ReleaseCandidate } from "../lib/artistApi";
import { worldArtworkUrl } from "../lib/worldApi";

export default function LinkExistingReleases({ name, creating, ensureArtist, onDone }: {
  name: string; creating: boolean; ensureArtist: () => Promise<string>;
  onDone: (message: string) => void;
}) {
  const [releases, setReleases] = useState<ReleaseCandidate[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [failures, setFailures] = useState<Record<string, string>>({});
  const query = creating ? name : "";
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setSelected([]); setFailures({}); setError("");
    fetchReleaseCandidates(query).then(r => {
      if (!cancelled) { setReleases(r.releases); setNextOffset(r.nextOffset); }
    }).catch(() => { if (!cancelled) setError("Could not load your releases. You can skip and link them from Band management later."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [query]);

  const more = async () => {
    if (nextOffset === null) return;
    setLoading(true);
    try { const r = await fetchReleaseCandidates(query, nextOffset); setReleases(old => [...old, ...r.releases]); setNextOffset(r.nextOffset); }
    catch { setError("Could not load more releases. Try again."); }
    finally { setLoading(false); }
  };
  const finish = async (skip: boolean) => {
    if (busy) return;
    setBusy(true); setError("");
    let id: string;
    try { id = await ensureArtist(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save the Band. Try again."); setBusy(false); return; }
    // Band identity is persisted before linking starts. A network interruption or
    // rejected release leaves the Band intact and can be retried in management.
    try {
      if (skip || !selected.length) { onDone(creating ? "Band saved. You can link existing releases later." : ""); return; }
      const result = await linkArtistReleases(id, selected);
      const failed = result.results.filter(r => !r.linked);
      const linked = new Set(result.results.filter(r => r.linked).map(r => r.id));
      setReleases(old => old.filter(r => !linked.has(r.id)));
      setSelected(failed.map(r => r.id));
      setFailures(Object.fromEntries(failed.map(r => [r.id, r.error || "release_link_failed"])));
      window.dispatchEvent(new Event("ysong:library-changed"));
      if (failed.length) setError(`Band saved. ${linked.size} release(s) linked; ${failed.length} could not be linked. Retry below or use Link Existing Releases later.`);
      else onDone(`Band saved. ${linked.size} release(s) linked.`);
    } catch { setError("Band saved, but linking could not be confirmed. Retry here or use Link Existing Releases in Band management; already-linked releases are safe to retry."); }
    finally { setBusy(false); }
  };
  return <section className="rounded-2xl border border-fuchsia-400/25 bg-white/[.025] p-4 space-y-3" aria-label="Link your existing music">
    <h2 className="text-lg font-semibold">{creating ? "Link your existing music" : "Link Existing Releases"}</h2>
    <p className="text-sm text-neutral-400">{creating
      ? `We found releases in your library that may belong to this band. Select any releases you want to connect to ${name}.`
      : `Select your unlinked releases to connect to ${name}. Artist names are suggestions; you decide which releases belong here.`}</p>
    <button type="button" disabled={busy || loading || !releases.length} onClick={() => setSelected(releases.slice(0, 100).map(r => r.id))} className="rounded-lg border border-white/15 px-3 py-1.5 text-sm disabled:opacity-40">Select All{releases.length > 100 ? " (first 100)" : ""}</button>
    {loading && <p role="status" className="text-sm text-neutral-400">Loading your releases…</p>}
    {!loading && !releases.length && !error && <p className="text-sm text-neutral-400">No unlinked releases found. You can continue without linking music.</p>}
    <div className="grid gap-2 sm:grid-cols-2 max-h-96 overflow-y-auto">
      {releases.map(r => <label key={r.id} className="flex items-center gap-3 rounded-xl border border-white/10 p-3 cursor-pointer">
        <input type="checkbox" checked={selected.includes(r.id)} disabled={busy || (!selected.includes(r.id) && selected.length >= 100)} onChange={e => setSelected(old => e.target.checked ? [...old, r.id] : old.filter(id => id !== r.id))} />
        <div className="h-14 w-14 shrink-0 rounded-lg bg-black/30 overflow-hidden grid place-items-center">{r.hasArtwork && r.coverTrackId ? <img alt="" src={worldArtworkUrl(r.coverTrackId)} className="h-full w-full object-cover" /> : <span className="text-xs text-neutral-500">No artwork</span>}</div>
        <div className="min-w-0 text-sm"><div className="font-medium">{r.title}</div><div className="text-neutral-400">{r.artistName}</div><div className="text-xs text-neutral-500">{r.releaseType === "album" ? "Album" : "Single"}{r.publishedAt ? ` · ${new Date(r.publishedAt).toLocaleDateString()}` : ""}</div>{failures[r.id] && <div className="text-xs text-red-300">Could not link: {failures[r.id].replaceAll("_", " ")}</div>}</div>
      </label>)}
    </div>
    {nextOffset !== null && <button type="button" disabled={loading || busy} onClick={() => void more()} className="text-sm text-fuchsia-200">Show more releases</button>}
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    <div className="flex flex-wrap gap-2"><button type="button" disabled={busy || loading || (!creating && !selected.length)} onClick={() => void finish(false)} className="rounded-xl border border-fuchsia-400/30 bg-fuchsia-500/20 px-4 py-2 disabled:opacity-40">{busy ? "Saving…" : creating ? "Create Band and continue" : "Link selected releases"}</button><button type="button" disabled={busy} onClick={() => creating ? void finish(true) : onDone("")} className="rounded-xl border border-white/10 px-4 py-2">Skip for now</button>{creating && <button type="button" disabled={busy} onClick={() => onDone("")} className="rounded-xl border border-white/10 px-4 py-2">Back</button>}</div>
  </section>;
}
