import { apiPost } from "./authApi";

type ArtworkGenerationResponse = {
  imageDataUrl: string;
  mimeType?: string;
  model?: string;
};

export async function generateArtworkImage(prompt: string, width: number, height: number): Promise<Blob> {
  const result = await apiPost<ArtworkGenerationResponse>("/api/artwork/generate", {
    prompt,
    width: Math.max(256, Math.round(width)),
    height: Math.max(256, Math.round(height)),
  });
  if (!result.imageDataUrl?.startsWith("data:image/")) throw new Error("Artwork provider returned no image.");
  const response = await fetch(result.imageDataUrl);
  if (!response.ok) throw new Error("Could not decode generated artwork.");
  return response.blob();
}
