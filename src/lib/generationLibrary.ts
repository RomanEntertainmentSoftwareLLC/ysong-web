/** Browser-local catalog for generated song records. Provider execution and
 * remote job ownership intentionally live outside this module. */
import { parseSongGenerationResult, type SongGenerationResult } from "./songGenerationContract";
export type GenerationStatus = "queued" | "running" | "succeeded" | "partial" | "failed" | "cancelled";

export type GenerationArtifact = {
  id: string;
  kind: "audio" | "project" | "image" | "midi" | "other";
  label: string;
  objectKey?: string;
  url?: string;
  projectId?: string;
  durationSec?: number;
};

export type GenerationOperation = "initial" | "retry" | "variation" | "stem-regeneration" | "edit";
export type GenerationLineage = {
  rootId: string;
  parentId?: string;
  version: number;
  operation: GenerationOperation;
  /** IDs and source text captured when this version was created; never follow mutable parent state. */
  sourceReferences: { generationId?: string; artifactIds: string[]; prompt: string; origin?: string };
};

export type GenerationRecord = {
  id: string;
  status: GenerationStatus;
  title: string;
  createdAt: number;
  updatedAt: number;
  source: { prompt: string; lyrics?: string; style?: string; origin?: string };
  artifacts: GenerationArtifact[];
  error?: string;
  folderId?: string;
  songResult?: SongGenerationResult;
  lineage?: GenerationLineage;
};

export type GenerationFolder = { id: string; name: string; createdAt: number; updatedAt: number };

const STORAGE_KEY = "ysong:generations:v1";
const STATUSES = new Set<GenerationStatus>(["queued", "running", "succeeded", "partial", "failed", "cancelled"]);
const FOLDERS_KEY = "ysong:generation-folders:v1";

function normalizeRecord(value: unknown): GenerationRecord | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<GenerationRecord>;
  if (typeof item.id !== "string" || !item.id.trim() || typeof item.title !== "string" ||
      typeof item.createdAt !== "number" || !Number.isFinite(item.createdAt) ||
      !item.source || typeof item.source !== "object" || typeof item.source.prompt !== "string") return null;
  const status = STATUSES.has(item.status as GenerationStatus) ? item.status as GenerationStatus : "succeeded";
  const artifacts = Array.isArray(item.artifacts) ? item.artifacts.filter((artifact): artifact is GenerationArtifact =>
    !!artifact && typeof artifact.id === "string" && typeof artifact.label === "string" &&
    ["audio", "project", "image", "midi", "other"].includes(artifact.kind)
  ) : [];
  return {
    id: item.id, status, title: item.title, createdAt: item.createdAt,
    updatedAt: typeof item.updatedAt === "number" && Number.isFinite(item.updatedAt) ? item.updatedAt : item.createdAt,
    source: { prompt: item.source.prompt, ...(typeof item.source.lyrics === "string" ? { lyrics: item.source.lyrics } : {}), ...(typeof item.source.style === "string" ? { style: item.source.style } : {}), ...(typeof item.source.origin === "string" ? { origin: item.source.origin } : {}) },
    artifacts: artifacts.map((artifact) => ({ ...artifact, ...(typeof artifact.durationSec === "number" && Number.isFinite(artifact.durationSec) && artifact.durationSec > 0 ? { durationSec: artifact.durationSec } : {}) })), ...(typeof item.error === "string" ? { error: item.error } : {}), ...(typeof item.folderId === "string" && item.folderId ? { folderId: item.folderId } : {}),
    ...(item.songResult ? { songResult: parseSongGenerationResult(item.songResult) ?? undefined } : {}),
    ...(item.lineage && typeof item.lineage.rootId === "string" && item.lineage.rootId && Number.isInteger(item.lineage.version) && item.lineage.version > 0 &&
      ["initial", "retry", "variation", "stem-regeneration", "edit"].includes(item.lineage.operation) &&
      item.lineage.sourceReferences && Array.isArray(item.lineage.sourceReferences.artifactIds) && typeof item.lineage.sourceReferences.prompt === "string"
      ? { lineage: { rootId: item.lineage.rootId, ...(typeof item.lineage.parentId === "string" ? { parentId: item.lineage.parentId } : {}), version: item.lineage.version, operation: item.lineage.operation, sourceReferences: { ...(typeof item.lineage.sourceReferences.generationId === "string" ? { generationId: item.lineage.sourceReferences.generationId } : {}), artifactIds: item.lineage.sourceReferences.artifactIds.filter((id): id is string => typeof id === "string"), prompt: item.lineage.sourceReferences.prompt, ...(typeof item.lineage.sourceReferences.origin === "string" ? { origin: item.lineage.sourceReferences.origin } : {}) } } }
      : {}),
  };
}

export function listGenerations(): GenerationRecord[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.map(normalizeRecord).filter((item): item is GenerationRecord => item !== null).sort((a, b) => b.createdAt - a.createdAt) : [];
  } catch { return []; }
}

export function saveGeneration(record: GenerationRecord): GenerationRecord {
  const normalized = normalizeRecord(record);
  if (!normalized) throw new Error("Invalid generation record.");
  const records = listGenerations();
  localStorage.setItem(STORAGE_KEY, JSON.stringify([normalized, ...records.filter((item) => item.id !== normalized.id)]));
  window.dispatchEvent(new CustomEvent("ysong:generations-changed"));
  return normalized;
}

export function upsertGeneration(input: Omit<GenerationRecord, "updatedAt"> & { updatedAt?: number }): GenerationRecord {
  const existing = listGenerations().find((item) => item.id === input.id);
  // Status updates for one job may fill in output fields, but cannot erase already saved artifacts or provenance.
  const artifacts = [...(existing?.artifacts ?? [])];
  for (const artifact of input.artifacts) if (!artifacts.some((saved) => saved.id === artifact.id)) artifacts.push(artifact);
  const lineage = input.lineage ?? existing?.lineage ?? { rootId: input.id, version: 1, operation: "initial" as const,
    sourceReferences: { artifactIds: [], prompt: input.source.prompt, ...(input.source.origin ? { origin: input.source.origin } : {}) } };
  return saveGeneration({ ...input, ...(existing ? { source: existing.source } : {}), artifacts, lineage, updatedAt: input.updatedAt ?? Date.now() });
}

/** Create an immutable child version. Parent records and their artifact references are never rewritten. */
export function createGenerationVersion(parentId: string, operation: Exclude<GenerationOperation, "initial">, changes: Pick<GenerationRecord, "title" | "status" | "source" | "artifacts"> & Partial<Pick<GenerationRecord, "songResult" | "error">> & { id?: string }): GenerationRecord {
  const parent = listGenerations().find((item) => item.id === parentId);
  if (!parent) throw new Error("Parent generation not found.");
  const id = changes.id ?? crypto.randomUUID();
  const rootId = parent.lineage?.rootId ?? parent.id;
  const siblings = listGenerations().filter((item) => (item.lineage?.rootId ?? item.id) === rootId);
  const lineage: GenerationLineage = { rootId, parentId: parent.id, version: Math.max(0, ...siblings.map((item) => item.lineage?.version ?? 1)) + 1, operation,
    sourceReferences: { generationId: parent.id, artifactIds: parent.artifacts.map((artifact) => artifact.id), prompt: parent.source.prompt, ...(parent.source.origin ? { origin: parent.source.origin } : {}) } };
  return upsertGeneration({ ...changes, id, createdAt: Date.now(), updatedAt: Date.now(), source: changes.source, artifacts: changes.artifacts, lineage });
}

function changed() { window.dispatchEvent(new CustomEvent("ysong:generations-changed")); }

export function listGenerationFolders(): GenerationFolder[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(FOLDERS_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is GenerationFolder => !!item && typeof item.id === "string" && !!item.id && typeof item.name === "string" && !!item.name.trim() && typeof item.createdAt === "number" && typeof item.updatedAt === "number").sort((a, b) => a.name.localeCompare(b.name));
  } catch { return []; }
}

export function createGenerationFolder(name: string): GenerationFolder {
  const clean = name.trim();
  if (!clean) throw new Error("Folder name is required.");
  const now = Date.now();
  const folder = { id: crypto.randomUUID(), name: clean, createdAt: now, updatedAt: now };
  localStorage.setItem(FOLDERS_KEY, JSON.stringify([...listGenerationFolders(), folder])); changed(); return folder;
}

export function renameGenerationFolder(id: string, name: string): GenerationFolder {
  const clean = name.trim(); if (!clean) throw new Error("Folder name is required.");
  let result: GenerationFolder | undefined;
  const folders = listGenerationFolders().map((folder) => folder.id === id ? (result = { ...folder, name: clean, updatedAt: Date.now() }) : folder);
  if (!result) throw new Error("Folder not found.");
  localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders)); changed(); return result;
}

/** Remove a folder while keeping every generation and its project references intact. */
export function deleteGenerationFolder(id: string): void {
  localStorage.setItem(FOLDERS_KEY, JSON.stringify(listGenerationFolders().filter((folder) => folder.id !== id)));
  const records = listGenerations().map((record) => { if (record.folderId !== id) return record; const unfiled = { ...record }; delete unfiled.folderId; return unfiled; });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records)); changed();
}

export function moveGenerationToFolder(generationId: string, folderId?: string): GenerationRecord {
  const folders = listGenerationFolders();
  if (folderId && !folders.some((folder) => folder.id === folderId)) throw new Error("Folder not found.");
  const record = listGenerations().find((item) => item.id === generationId);
  if (!record) throw new Error("Generation not found.");
  const unfiled = { ...record }; delete unfiled.folderId;
  return saveGeneration({ ...unfiled, ...(folderId ? { folderId } : {}), updatedAt: Date.now() });
}

/** Delete only the library record; linked local projects and artifacts are not deleted. */
export function deleteGeneration(id: string): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(listGenerations().filter((record) => record.id !== id))); changed();
}
