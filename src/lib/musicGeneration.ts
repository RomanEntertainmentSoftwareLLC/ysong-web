export type MusicEngineStatus = {
  configured: boolean;
  reachable: boolean;
  baseUrl: string;
  model: string;
  message?: string;
  provider?: "audio_cpp" | "http" | string;
  backend?: string;
  busy?: boolean;
};

export type GenerateTrackRequest = {
  lyrics: string;
  instructions: string;
  seed?: number;
  maxNewTokens?: number;
  durationSeconds?: number;
  quality?: "draft" | "standard" | "final";
};

const env = (import.meta as any).env || {};
const RAW_BASE = env.VITE_AUTH_API_URL || env.VITE_API_BASE_URL || "";
const API = String(RAW_BASE || "").replace(/\/+$/, "");

function endpoint(path: string) {
  return API ? `${API}${path}` : path;
}

export async function getMusicEngineStatus(): Promise<MusicEngineStatus> {
  const res = await fetch(endpoint("/api/music/status"));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
  return data as MusicEngineStatus;
}

export async function generateMiniMaxTrack(request: GenerateTrackRequest): Promise<Blob> {
  const res = await fetch(endpoint("/api/music/generate"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.message || data?.error || `MiniMax HTTP ${res.status}`);
  }
  const blob = await res.blob();
  if (!blob.size) throw new Error("MiniMax returned an empty audio file.");
  return blob.type ? blob : new Blob([blob], { type: "audio/wav" });
}

export async function uploadGeneratedAudio(blob: Blob, filename: string) {
  const token = localStorage.getItem("ys_token");
  if (!token) throw new Error("YSong login is required before generated tracks can be saved.");
  const form = new FormData();
  const file = new File([blob], filename, { type: blob.type || "audio/wav" });
  form.append("file", file);
  const res = await fetch(endpoint("/api/uploads"), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || data?.error || `Upload HTTP ${res.status}`);
  return data as { objectKey: string; id?: string; name?: string };
}

export async function decodeAudioDuration(blob: Blob): Promise<number> {
  const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
  const ctx = new AudioContextCtor();
  try {
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    return buffer.duration;
  } finally {
    await ctx.close().catch(() => {});
  }
}
