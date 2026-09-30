import type { AdCreative } from "./api";
import type { StudioVisualClip } from "./creativeStudioProject";

export type CompletedVideoJob = { id: string; status: "completed"; authorized: true; creativeId: string; provider: string; providerJobId: string; prompt: string; artifact: { objectKey: string; durationSeconds: number; metadata: Record<string, unknown> } };

/** Only server-supplied, authorized completed jobs with an owned artifact can enter Studio. */
export function completedVideoJobs(creative: AdCreative): CompletedVideoJob[] {
  const items = creative.metadata?.aiVideoJobs;
  if (!Array.isArray(items)) return [];
  const isString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
  return items.filter((item): item is CompletedVideoJob => {
    if (!item || typeof item !== "object") return false;
    const job = item as Record<string, unknown>;
    const artifact = job.artifact;
    if (!artifact || typeof artifact !== "object") return false;
    const media = artifact as Record<string, unknown>;
    return job.status === "completed" && job.authorized === true && job.creativeId === creative.stableCreativeId
      && [job.id, job.provider, job.providerJobId, job.prompt, media.objectKey].every(isString)
      && typeof media.durationSeconds === "number" && Number.isFinite(media.durationSeconds) && media.durationSeconds > 0
      && !!media.metadata && typeof media.metadata === "object" && !Array.isArray(media.metadata);
  });
}

export function generatedVideoSource(job: CompletedVideoJob): NonNullable<StudioVisualClip["generatedVideo"]> {
  return { jobId: job.id, provider: job.provider, providerJobId: job.providerJobId, prompt: job.prompt, objectKey: job.artifact.objectKey, durationSeconds: job.artifact.durationSeconds, artifactMetadata: job.artifact.metadata };
}
