import { useEffect, useState } from "react";
import { detectPlatform, parseBridgeRelease, type BridgeRelease, type Platform } from "../lib/bridgeReleases";

const labels: Record<Platform, string> = { windows: "Windows", macos: "macOS", linux: "Linux" };
const guidance: Record<Platform, string> = {
  windows: "Download the installer, verify its SHA-256 checksum, then run it and follow the setup prompts.",
  macos: "Download the package, verify its SHA-256 checksum, then open it and follow the installation prompts.",
  linux: "Download the package for your architecture, verify its SHA-256 checksum, then install it with your distribution's package manager.",
};
const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim().replace(/\/$/, "") || "";
const manifestUrl = (import.meta.env.VITE_BRIDGE_RELEASE_MANIFEST_URL as string | undefined)?.trim() || `${apiBase}/api/bridge/releases/manifest`;

export default function BridgeDownloads() {
  const [platform, setPlatform] = useState<Platform>(() => detectPlatform(navigator.userAgent));
  const [release, setRelease] = useState<BridgeRelease | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");
  useEffect(() => {
    const controller = new AbortController();
    fetch(manifestUrl, { signal: controller.signal, cache: "no-store", headers: { Accept: "application/json" } })
      .then(async response => {
        if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) throw new Error("Manifest unavailable");
        return parseBridgeRelease(await response.json());
      })
      .then(data => { if (!controller.signal.aborted) { setRelease(data); setState(data ? "ready" : "unavailable"); } })
      .catch(() => { if (!controller.signal.aborted) setState("unavailable"); });
    return () => controller.abort();
  }, []);
  const artifacts = release?.artifacts.filter(item => item.platform === platform) ?? [];
  return <section className="mt-5 rounded-2xl border border-white/10 bg-white/[.025] p-5" aria-labelledby="bridge-downloads-title">
    <h2 id="bridge-downloads-title" className="text-lg font-semibold">Download YSong Bridge</h2>
    <p className="mt-2 text-sm text-neutral-400">Choose an installer for your computer. Your platform is selected automatically; you can switch at any time.</p>
    <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Choose operating system">
      {(Object.keys(labels) as Platform[]).map(choice => <button key={choice} type="button" aria-pressed={platform === choice} onClick={() => setPlatform(choice)} className={`rounded-lg border px-4 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 ${platform === choice ? "border-cyan-400 bg-cyan-400/15 text-cyan-100" : "border-white/15 text-neutral-300 hover:bg-white/10"}`}>{labels[choice]}</button>)}
    </div>
    <div className="mt-4" aria-live="polite">
      {state === "loading" && <p className="text-sm text-neutral-400">Checking current production releases…</p>}
      {state === "unavailable" && <p className="text-sm text-amber-200">Production download information is unavailable right now. Please check back soon.</p>}
      {state === "ready" && artifacts.length === 0 && <p className="text-sm text-amber-200">A production download for {labels[platform]} is coming soon.</p>}
      {state === "ready" && artifacts.length > 0 && <div className="grid gap-3 md:grid-cols-2">{artifacts.map(item => <article key={`${item.architecture}-${item.url}`} className="min-w-0 rounded-xl border border-white/10 bg-black/20 p-4">
        <h3 className="font-semibold">{labels[platform]} · {item.architecture}</h3>
        <p className="mt-1 text-sm text-neutral-300">Version {item.version} · {item.fileType}{item.sizeBytes ? ` · ${(item.sizeBytes / 1048576).toFixed(1)} MB` : ""}</p>
        <p className="mt-1 text-sm text-emerald-200">{item.signatureStatus}</p>
        {item.notarizationStatus && <p className="mt-1 text-sm text-emerald-200">{item.notarizationStatus}</p>}
        {item.certificationStatus && <p className="mt-1 text-sm text-emerald-200">{item.certificationStatus}</p>}
        <a className="mt-3 inline-block rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-neutral-950 hover:bg-cyan-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white" href={item.url} rel="noopener noreferrer">Download for {labels[platform]} ({item.architecture})</a>
        <details className="mt-3 text-xs text-neutral-400"><summary className="cursor-pointer">Checksum and installation details</summary><p className="mt-2 break-all">SHA-256: {item.sha256}</p><p className="mt-2">{item.installation || guidance[platform]}</p></details>
      </article>)}</div>}
    </div>
    {release?.notesUrl && <a className="mt-4 inline-block text-sm text-cyan-300 underline" href={release.notesUrl} target="_blank" rel="noopener noreferrer">Release notes for version {release.version}</a>}
  </section>;
}
