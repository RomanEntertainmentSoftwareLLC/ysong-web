import type { CritiqueReport } from "./api.ts";
import type { UploadResult } from "../stemrestore/api.ts";

const KEY = "ysong:critique-reports:v1";
const LIMIT = 30;

export type SavedCritique = {
  id: string;
  savedAt: number;
  sourceName: string;
  sourceSha256: string;
  analysisMode: string;
  engine: string;
  upload: UploadResult;
  report: CritiqueReport;
  reportArtifactUrl: string;
  sourceArtifactUrl: string;
};

export async function critiqueSourceHash(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function loadCritiques(): SavedCritique[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) || "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((row): row is SavedCritique => !!row && typeof row === "object" &&
      typeof row.id === "string" && typeof row.sourceSha256 === "string" &&
      typeof row.engine === "string" && typeof row.savedAt === "number" &&
      typeof row.upload?.asset_id === "string" && row.report?.asset_id === row.upload.asset_id &&
      typeof row.reportArtifactUrl === "string" && typeof row.sourceArtifactUrl === "string");
  } catch { return []; }
}

export function saveCritique(record: SavedCritique): void {
  const previous = loadCritiques().filter(item => item.id !== record.id);
  localStorage.setItem(KEY, JSON.stringify([record, ...previous].slice(0, LIMIT)));
}
