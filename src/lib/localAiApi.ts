export type LocalAiMessage = { role: "system" | "user" | "assistant"; content: string };

const env = (import.meta as any).env || {};

// Local studio AI intentionally follows the same backend route as the working
// YSong chat surface. Do NOT use VITE_API_URL here: that value can point at the
// old cloud API while the desktop Auth API + Vite proxy live on this machine.
const RAW_BASE = env.VITE_AUTH_API_URL || env.VITE_API_BASE_URL || "";
export const LOCAL_AI_BASE = String(RAW_BASE || "").replace(/\/+$/, "");

export async function localAiChat(messages: LocalAiMessage[]): Promise<string> {
  const endpoint = LOCAL_AI_BASE ? `${LOCAL_AI_BASE}/chat` : "/chat";
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
  return String(data?.reply || "");
}
