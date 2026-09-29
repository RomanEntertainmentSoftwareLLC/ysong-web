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
};

const STORAGE_KEY = "ysong:generations:v1";
const STATUSES = new Set<GenerationStatus>(["queued", "running", "succeeded", "failed", "cancelled"]);

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
    artifacts, ...(typeof item.error === "string" ? { error: item.error } : {}),
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
