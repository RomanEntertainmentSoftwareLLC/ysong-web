import { downloadBlob, buildStandardMidiFile } from "./dawExport.ts";
import type { GenerationRecord } from "./generationLibrary.ts";
import { parseSongGenerationResult } from "./songGenerationContract.ts";

export type GenerationExportManifest = {
  schema: "ysong.generation-export";
  version: 1;
  generation: { id: string; title: string; status: string; createdAt: string };
  provenance: { origin?: string; prompt: string; style?: string; provider?: string; model?: string; seed?: number; lineage?: { rootId: string; parentId?: string; version: number; operation: string } };
  timebase?: { bpm: number; sigNum: number; sigDen: number; totalBars: number };
  files: Array<{ path: string; kind: "mix" | "stem" | "midi" | "lyrics"; partId?: string }>;
  omissions: Array<{ item: string; reason: string }>;
};

type ZipEntry = { name: string; data: Uint8Array };
const encoder = new TextEncoder();

export function safeGenerationExportName(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "generation";
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function u16(view: DataView, at: number, value: number) { view.setUint16(at, value, true); }
function u32(view: DataView, at: number, value: number) { view.setUint32(at, value, true); }

/** Small deterministic ZIP writer using stored entries (no compression or external dependency). */
export function createDeterministicZip(entries: ZipEntry[]): Blob {
  const ordered = [...entries].sort((a, b) => a.name.localeCompare(b.name, "en"));
  if (ordered.some((entry, index) => index > 0 && entry.name === ordered[index - 1].name)) throw new Error("Export contains duplicate filenames.");
  const local: Uint8Array[] = []; const central: Uint8Array[] = []; let offset = 0;
  for (const entry of ordered) {
    const name = encoder.encode(entry.name); const crc = crc32(entry.data);
    const header = new Uint8Array(30 + name.length); const hv = new DataView(header.buffer);
    u32(hv, 0, 0x04034b50); u16(hv, 4, 20); u16(hv, 6, 0x0800); u16(hv, 8, 0); u16(hv, 10, 0); u16(hv, 12, 0);
    u32(hv, 14, crc); u32(hv, 18, entry.data.length); u32(hv, 22, entry.data.length); u16(hv, 26, name.length); u16(hv, 28, 0); header.set(name, 30);
    local.push(header, entry.data);
    const directory = new Uint8Array(46 + name.length); const dv = new DataView(directory.buffer);
    u32(dv, 0, 0x02014b50); u16(dv, 4, 20); u16(dv, 6, 20); u16(dv, 8, 0x0800); u16(dv, 10, 0);
    u16(dv, 12, 0); u16(dv, 14, 0); u32(dv, 16, crc); u32(dv, 20, entry.data.length); u32(dv, 24, entry.data.length);
    u16(dv, 28, name.length); u16(dv, 30, 0); u16(dv, 32, 0); u16(dv, 34, 0); u16(dv, 36, 0); u32(dv, 38, 0); u32(dv, 42, offset); directory.set(name, 46);
    central.push(directory); offset += header.length + entry.data.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0); const end = new Uint8Array(22); const ev = new DataView(end.buffer);
  u32(ev, 0, 0x06054b50); u16(ev, 4, 0); u16(ev, 6, 0); u16(ev, 8, ordered.length); u16(ev, 10, ordered.length); u32(ev, 12, centralSize); u32(ev, 16, offset); u16(ev, 20, 0);
  const parts = [...local, ...central, end].map((bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  return new Blob(parts, { type: "application/zip" });
}

async function fetchObject(objectKey: string): Promise<Blob> {
  const token = localStorage.getItem("ys_token") || localStorage.getItem("ysong_auth_token");
  if (!token) throw new Error("Sign in to download this asset.");
  const base = (import.meta.env.VITE_AUTH_API_URL || "").replace(/\/+$/, "");
  const signedResponse = await fetch(`${base}/api/uploads/signed-url?${new URLSearchParams({ objectKey, mode: "download" })}`, { headers: { Authorization: `Bearer ${token}` }, credentials: "include" });
  if (!signedResponse.ok) throw new Error(`Asset link unavailable (${signedResponse.status}).`);
  const data = await signedResponse.json() as { url?: unknown };
  if (typeof data.url !== "string" || !/^https:\/\//i.test(data.url)) throw new Error("Asset link was invalid.");
  const response = await fetch(data.url); if (!response.ok) throw new Error(`Asset download unavailable (${response.status}).`);
  return response.blob();
}
function safeFilename(name: string) { return name.replace(/[<>:"/\\|?*]/g, "-").replace(/\p{Cc}/gu, "-").replace(/\.+$/g, "").slice(0, 80) || "part"; }
function uniquePath(path: string, used: Set<string>): string {
  if (!used.has(path)) { used.add(path); return path; }
  const dot = path.lastIndexOf("."); const stem = dot > path.lastIndexOf("/") ? path.slice(0, dot) : path; const extension = dot > path.lastIndexOf("/") ? path.slice(dot) : "";
  let suffix = 2; while (used.has(`${stem}-${suffix}${extension}`)) suffix++;
  const unique = `${stem}-${suffix}${extension}`; used.add(unique); return unique;
}

export async function exportGenerationPackage(record: GenerationRecord): Promise<{ filename: string; included: number; omitted: number }> {
  const result = parseSongGenerationResult(record.songResult); const prefix = safeGenerationExportName(record.title); const id = safeGenerationExportName(record.id).slice(0, 32);
  const entries: ZipEntry[] = []; const files: GenerationExportManifest["files"] = []; const omissions: GenerationExportManifest["omissions"] = [];
  const usedPaths = new Set<string>(["manifest.json"]); let audioCount = 0;
  for (const [index, artifact] of record.artifacts.entries()) {
    if (artifact.kind === "midi" && artifact.objectKey) {
      const path = uniquePath(`midi/${safeGenerationExportName(artifact.id)}-${safeFilename(artifact.label)}.mid`, usedPaths);
      try { const blob = await fetchObject(artifact.objectKey); entries.push({ name: path, data: new Uint8Array(await blob.arrayBuffer()) }); files.push({ path, kind: "midi", partId: artifact.id }); }
      catch (error) { omissions.push({ item: artifact.label || `midi-${index + 1}`, reason: error instanceof Error ? error.message : "Asset unavailable." }); }
      continue;
    }
    if (artifact.kind !== "audio") continue;
    if (!artifact.objectKey && !artifact.url) { omissions.push({ item: artifact.label || `audio-${index + 1}`, reason: "No downloadable audio reference was saved." }); continue; }
    const path = uniquePath(`audio/mix-${String(++audioCount).padStart(2, "0")}-${safeGenerationExportName(artifact.id).slice(0, 24)}-${safeFilename(artifact.label)}.wav`, usedPaths);
    try {
      const blob = artifact.objectKey ? await fetchObject(artifact.objectKey) : await (async () => { const response = await fetch(artifact.url!); if (!response.ok) throw new Error(`Asset download unavailable (${response.status}).`); return response.blob(); })();
      entries.push({ name: path, data: new Uint8Array(await blob.arrayBuffer()) }); files.push({ path, kind: "mix", partId: artifact.id || String(index + 1) });
    } catch (error) { omissions.push({ item: artifact.label || `audio-${index + 1}`, reason: error instanceof Error ? error.message : "Asset unavailable." }); }
  }
  if (result) for (const part of result.parts) {
    if (part.status !== "ready") { omissions.push({ item: part.name, reason: part.failure?.message || "Part is not available." }); continue; }
    if (part.kind === "audio" && part.audio && !record.artifacts.some((artifact) => artifact.kind === "audio" && artifact.objectKey === part.audio?.objectKey)) {
      const path = uniquePath(`audio/stem-${safeGenerationExportName(part.id)}-${safeFilename(part.name)}.wav`, usedPaths);
      try { const blob = await fetchObject(part.audio.objectKey); entries.push({ name: path, data: new Uint8Array(await blob.arrayBuffer()) }); files.push({ path, kind: "stem", partId: part.id }); }
      catch (error) { omissions.push({ item: part.name, reason: error instanceof Error ? error.message : "Asset unavailable." }); }
    } else if (part.kind === "audio" && part.audio) {
      const artifact = record.artifacts.find((item) => item.kind === "audio" && item.objectKey === part.audio?.objectKey);
      const path = artifact && files.find((file) => file.kind === "mix" && file.partId === artifact.id)?.path;
      if (path) files.push({ path, kind: "stem", partId: part.id });
      else if (artifact) omissions.push({ item: part.name, reason: "Matching mix asset could not be downloaded." });
    } else if (part.kind === "midi" && part.midi) {
      const notes = part.midi.regions.flatMap((region) => Array.from({ length: region.repeatCount ?? 1 }, (_, repeat) => region.notes.map((note) => ({ ...note, startBars: (region.startBar - 1) + repeat * region.lengthBars + note.startBars }))).flat());
      const tracks = [{ name: part.name, notes }];
      const path = uniquePath(`midi/${safeGenerationExportName(part.id)}-${safeFilename(part.name)}.mid`, usedPaths);
      const bytes = buildStandardMidiFile({ bpm: result.timebase.bpm, sigNum: result.timebase.sigNum, sigDen: result.timebase.sigDen, endBar: result.timebase.totalBars + 1, tracks });
      entries.push({ name: path, data: bytes }); files.push({ path, kind: "midi", partId: part.id });
    }
  }
  const lyrics = record.source.lyrics?.trim();
  if (lyrics) { const path = uniquePath("lyrics/lyrics.txt", usedPaths); entries.push({ name: path, data: encoder.encode(lyrics.replace(/\r\n?/g, "\n")) }); files.push({ path, kind: "lyrics" }); }
  else omissions.push({ item: "lyrics", reason: "No lyrics were saved with this generation." });
  const manifest: GenerationExportManifest = {
    schema: "ysong.generation-export", version: 1,
    generation: { id: record.id, title: record.title, status: result?.status ?? record.status, createdAt: new Date(record.createdAt).toISOString() },
    provenance: { ...(record.source.origin ? { origin: record.source.origin } : {}), prompt: record.source.prompt,
      ...(record.source.style ? { style: record.source.style } : {}), ...(result ? { provider: result.model.provider, model: result.model.name, ...(result.source.seed !== undefined ? { seed: result.source.seed } : {}) } : {}),
      ...(record.lineage ? { lineage: { rootId: record.lineage.rootId, ...(record.lineage.parentId ? { parentId: record.lineage.parentId } : {}), version: record.lineage.version, operation: record.lineage.operation } } : {}) },
    ...(result ? { timebase: { bpm: result.timebase.bpm, sigNum: result.timebase.sigNum, sigDen: result.timebase.sigDen, totalBars: result.timebase.totalBars } } : {}),
    files: files.sort((a, b) => a.path.localeCompare(b.path, "en")), omissions,
  };
  entries.push({ name: "manifest.json", data: encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`) });
  const filename = `${prefix}-${id}-export.zip`; downloadBlob(createDeterministicZip(entries), filename);
  return { filename, included: files.length, omitted: omissions.length };
}
