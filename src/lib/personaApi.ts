import { AUTH_BASE, apiGet, apiPost } from "./authApi";

export type Persona = {
  id: string;
  name: string;
  description: string;
  specialty: string;
  humorStyle: string;
  socialEnergy: number;
  critiqueLevel: number;
  avatarPath: string;
  isCustom: boolean;
  hasCustomAvatar: boolean;
  sortOrder: number;
  metadata?: Record<string, any>;
  avatarUrl?: string;
};

export const DEFAULT_PERSONA_ID = "persona_surfer_v1";

export async function listPersonas(): Promise<Persona[]> {
  const data = await apiGet<{ personas?: Persona[] }>("/api/personas");
  const personas = Array.isArray(data.personas) ? data.personas : [];
  return Promise.all(personas.map(async (p) => {
    if (p.avatarPath || !p.hasCustomAvatar) return p;
    try {
      const a = await apiGet<{ url?: string }>(`/api/personas/${encodeURIComponent(p.id)}/avatar`);
      return { ...p, avatarUrl: a.url || "" };
    } catch {
      return p;
    }
  }));
}

export async function getChatPersona(chatId: string) {
  return apiGet<{ persona: Persona | null; personaId: string }>(`/api/chats/${encodeURIComponent(chatId)}/persona`);
}

export async function setChatPersona(chatId: string, personaId: string) {
  return apiPost<{ ok: true; persona: Persona }>(`/api/chats/${encodeURIComponent(chatId)}/persona`, { personaId });
}

export async function createCustomPersona(input: {
  name: string;
  description?: string;
  specialty?: string;
  humorStyle?: string;
  instructions: string;
  socialEnergy?: number;
  critiqueLevel?: number;
  avatarObjectKey?: string;
}) {
  return apiPost<{ persona: Persona }>("/api/personas/custom", input);
}

export async function deleteCustomPersona(personaId: string) {
  return apiPost<{ ok: true }>(`/api/personas/${encodeURIComponent(personaId)}/delete`, {});
}

function token() {
  try { return localStorage.getItem("ys_token") || localStorage.getItem("ysong_auth_token") || ""; } catch { return ""; }
}

export async function uploadPersonaAvatar(file: File) {
  const form = new FormData();
  form.append("file", file);
  const t = token();
  const res = await fetch(`${AUTH_BASE}/api/uploads`, {
    method: "POST",
    headers: t ? { Authorization: `Bearer ${t}` } : undefined,
    credentials: "include",
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "avatar_upload_failed");
  return data as { objectKey: string };
}

export function personaImage(persona?: Persona | null) {
  if (!persona) return "/ai-personas/surfer-dude.png";
  return persona.avatarUrl || persona.avatarPath || "";
}
