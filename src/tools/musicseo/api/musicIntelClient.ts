import { AUTH_BASE, apiGet, apiPost } from "../../../lib/authApi";
import type {
  ApiHealth,
  GenreAtlasScanJob,
  GenreAtlasStats,
  GenreCatalogResponse,
  GenreRadarReport,
  GenreRadarUniverseKey,
  NicheIntelReport,
  MlPrediction,
  MlStatus,
  ReleaseOutcome,
  ReleaseOutcomeInput,
} from "../types/musicIntel";

const ROOT = "/api/tools/seo";

export async function fetchApiHealth(): Promise<ApiHealth> {
  return apiGet<ApiHealth>(`${ROOT}/health`);
}

export async function fetchNicheIntel(query: string): Promise<NicheIntelReport> {
  const params = new URLSearchParams({ q: query });
  return apiGet<NicheIntelReport>(`${ROOT}/analyze?${params.toString()}`);
}

export async function fetchGenreRadar(
  universe: Extract<GenreRadarUniverseKey, "starter" | "expanded">,
  topCount: 10 | 20,
): Promise<GenreRadarReport> {
  const params = new URLSearchParams({ universe, top: String(topCount) });
  return apiGet<GenreRadarReport>(`${ROOT}/genre-radar?${params.toString()}`);
}

export async function fetchGenreCatalog(query: string, limit = 20): Promise<GenreCatalogResponse> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  return apiGet<GenreCatalogResponse>(`${ROOT}/genre-catalog?${params.toString()}`);
}

export async function fetchGenreAtlasStats(): Promise<GenreAtlasStats> {
  return apiGet<GenreAtlasStats>(`${ROOT}/genre-atlas/stats`);
}

export async function startGenreAtlasScan(topCount: 10 | 20, refineCount = 80): Promise<GenreAtlasScanJob> {
  const params = new URLSearchParams({ top: String(topCount), refine: String(refineCount) });
  return apiGet<GenreAtlasScanJob>(`${ROOT}/genre-atlas/start?${params.toString()}`);
}

export async function fetchGenreAtlasScanStatus(jobId: string): Promise<GenreAtlasScanJob> {
  const params = new URLSearchParams({ id: jobId });
  return apiGet<GenreAtlasScanJob>(`${ROOT}/genre-atlas/status?${params.toString()}`);
}

export async function fetchLatestGenreAtlasScan(): Promise<GenreAtlasScanJob> {
  return apiGet<GenreAtlasScanJob>(`${ROOT}/genre-atlas/latest`);
}

export async function fetchMlStatus(): Promise<MlStatus> {
  return apiGet<MlStatus>(`${ROOT}/ml/status`);
}

export async function fetchMlPrediction(input: {
  genre: string;
  demand: number;
  supply: number;
  momentum: number;
  competition: number;
  opportunityGap: number;
}): Promise<MlPrediction> {
  const params = new URLSearchParams({
    genre: input.genre,
    demand: String(input.demand),
    supply: String(input.supply),
    momentum: String(input.momentum),
    competition: String(input.competition),
    opportunityGap: String(input.opportunityGap),
  });
  return apiGet<MlPrediction>(`${ROOT}/ml/predict?${params.toString()}`);
}

export async function fetchReleaseOutcomes(): Promise<ReleaseOutcome[]> {
  const payload = await apiGet<{ outcomes: ReleaseOutcome[] }>(`${ROOT}/outcomes`);
  return payload.outcomes;
}

export async function createReleaseOutcome(input: ReleaseOutcomeInput): Promise<ReleaseOutcome> {
  const payload = await apiPost<{ outcome: ReleaseOutcome }>(`${ROOT}/outcomes`, input as unknown as Record<string, any>);
  return payload.outcome;
}

export async function downloadSeoServerCsv(kind: "outcomes" | "scans"): Promise<void> {
  const token = (() => {
    try { return localStorage.getItem("ys_token") || localStorage.getItem("ysong_auth_token") || ""; } catch { return ""; }
  })();
  const response = await fetch(`${AUTH_BASE}${ROOT}/${kind}/export.csv`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    credentials: "include",
  });
  if (!response.ok) throw new Error(`Export failed with HTTP ${response.status}.`);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = kind === "outcomes" ? "ysong-seo-outcomes.csv" : "ysong-seo-scans.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}
