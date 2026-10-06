export type Platform = "windows" | "macos" | "linux";
export type BridgeArtifact = {
  platform: Platform; architecture: string; version: string; url: string;
  fileType: string; sizeBytes?: number; sha256: string;
  signatureStatus: string; notarizationStatus?: string; certificationStatus?: string; installation?: string;
};
export type BridgeRelease = { version: string; notesUrl?: string; artifacts: BridgeArtifact[] };

const platforms: Platform[] = ["windows", "macos", "linux"];
const secureUrl = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
};

// Only explicitly published, signed production artifacts become download links.
export function parseBridgeRelease(input: unknown): BridgeRelease | null {
  if (!input || typeof input !== "object") return null;
  const release = input as Record<string, unknown>;
  if (release.channel !== "production" || typeof release.version !== "string" || !release.version.trim() || !Array.isArray(release.artifacts)) return null;
  const artifacts = release.artifacts.flatMap((entry: unknown): BridgeArtifact[] => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    if (!platforms.includes(item.platform as Platform) || item.channel !== "production" || item.status !== "published" ||
      item.signed !== true || !secureUrl(item.url) || typeof item.architecture !== "string" || !item.architecture.trim() ||
      typeof item.fileType !== "string" || !item.fileType.trim() || typeof item.sha256 !== "string" || !/^[a-f\d]{64}$/i.test(item.sha256) ||
      typeof item.signatureStatus !== "string" || !item.signatureStatus.trim() ||
      (item.platform === "macos" && item.notarized !== true)) return [];
    return [{ platform: item.platform as Platform, architecture: item.architecture, version: release.version as string,
      url: item.url, fileType: item.fileType, sha256: item.sha256, signatureStatus: item.signatureStatus,
      sizeBytes: typeof item.sizeBytes === "number" && item.sizeBytes > 0 ? item.sizeBytes : undefined,
      notarizationStatus: typeof item.notarizationStatus === "string" ? item.notarizationStatus : undefined,
      certificationStatus: typeof item.certificationStatus === "string" ? item.certificationStatus : undefined,
      installation: typeof item.installation === "string" ? item.installation : undefined }];
  });
  return { version: release.version, notesUrl: secureUrl(release.notesUrl) ? release.notesUrl : undefined, artifacts };
}

export function detectPlatform(userAgent: string): Platform {
  if (/windows/i.test(userAgent)) return "windows";
  if (/macintosh|mac os/i.test(userAgent)) return "macos";
  if (/linux|x11/i.test(userAgent)) return "linux";
  return "windows";
}
