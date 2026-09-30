import type { AudioIntelligenceReport } from "../audiointelligence/api";

export type AdsGenreResult = {
  primary: string;
  secondary: string | null;
  related: string[];
  family: string | null;
  engine: string;
};

export function genresFromAudioReport(report: AudioIntelligenceReport): AdsGenreResult {
  const primary = report.genre.primary_subgenre || report.genre.primary_genre || "";
  const candidates = report.genre.candidates
    .map(row => row.genre?.trim())
    .filter((genre): genre is string => Boolean(genre));
  const unique = [...new Set(candidates.filter(genre => genre.toLowerCase() !== primary.toLowerCase()))];
  return {
    primary,
    secondary: unique[0] || null,
    related: unique.slice(1, 7),
    family: report.genre.primary_genre,
    engine: report.engine,
  };
}

export function genreSearchSeeds(result: AdsGenreResult | null): string[] {
  if (!result) return [];
  return [result.primary, result.secondary, ...result.related].filter((value): value is string => Boolean(value));
}
