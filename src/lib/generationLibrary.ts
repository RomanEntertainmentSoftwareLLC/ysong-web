/** Browser-local catalog for generated song records. Provider execution and
 * remote job ownership intentionally live outside this module. */
export type GenerationStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type GenerationArtifact = {
  id: string;
  kind: "audio" | "project" | "image" | "midi" | "other";
  label: string;
  objectKey?: string;
  url?: string;
  projectId?: string;
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
};

export type GenerationFolder = { id: string; name: string; createdAt: number; updatedAt: number };

const STORAGE_KEY = "ysong:generations:v1";
const STATUSES = new Set<GenerationStatus>(["queued", "running", "succeeded", "failed", "cancelled"]);
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
    artifacts, ...(typeof item.error === "string" ? { error: item.error } : {}), ...(typeof item.folderId === "string" && item.folderId ? { folderId: item.folderId } : {}),
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
  return saveGeneration({ ...input, updatedAt: input.updatedAt ?? Date.now() });
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
