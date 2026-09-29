import { AUTH_BASE, apiGet, apiPost } from "./authApi";
import { listRegisteredPersonas, removeCustomPersona, saveCustomPersona, type PersonaRecord } from "./ysongPersonaRegistry";

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
  metadata?: Record<string, unknown>;
  avatarUrl?: string;
};

export { DEFAULT_PERSONA_ID } from "./ysongPersonaRegistry";

function fromRegistryRecord(record: PersonaRecord): Persona {
  return {
    id: record.id,
    name: record.display.name,
    description: record.display.description,
    specialty: record.display.specialty,
    humorStyle: record.behavior.humorStyle,
    socialEnergy: record.behavior.socialEnergy,
    critiqueLevel: record.behavior.critiqueLevel,
    avatarPath: record.assets.avatar || record.assets.portrait || "",
    isCustom: record.kind === "custom",
    hasCustomAvatar: Boolean(record.assets.avatar),
    sortOrder: record.sortOrder,
    metadata: { ...(record.metadata || {}), capabilities: record.capabilities, assets: record.assets, instructions: record.behavior.instructions },
  };
}

function toRegistryRecord(persona: Persona, instructions?: string): PersonaRecord {
  const metadata = persona.metadata || {};
  const capabilities = metadata.capabilities as PersonaRecord["capabilities"] | undefined;
  const assets = metadata.assets as PersonaRecord["assets"] | undefined;
  return {
    id: persona.id,
    kind: "custom",
    display: { name: persona.name, description: persona.description, specialty: persona.specialty },
    behavior: {
      humorStyle: persona.humorStyle,
      instructions: instructions ?? (typeof metadata.instructions === "string" ? metadata.instructions : undefined),
      socialEnergy: persona.socialEnergy,
      critiqueLevel: persona.critiqueLevel,
    },
    capabilities: capabilities || { chat: true, rooms: true, daw: false, musicCreation: false },
    assets: assets || { avatar: persona.avatarPath || undefined },
    sortOrder: persona.sortOrder,
    metadata,
  };
}

export async function listPersonas(): Promise<Persona[]> {
  const data = await apiGet<{ personas?: Persona[] }>("/api/personas");
  const remotePersonas = Array.isArray(data.personas) ? data.personas : [];
  const remoteIds = new Set(remotePersonas.map((persona) => persona.id));
  const localPersonas = listRegisteredPersonas().filter((persona) => persona.kind === "custom" && !remoteIds.has(persona.id)).map(fromRegistryRecord);
  const personas = [...remotePersonas, ...localPersonas];
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
  const result = await apiPost<{ persona: Persona }>("/api/personas/custom", input);
  saveCustomPersona(toRegistryRecord(result.persona, input.instructions));
  return result;
}

export async function deleteCustomPersona(personaId: string) {
  const result = await apiPost<{ ok: true }>(`/api/personas/${encodeURIComponent(personaId)}/delete`, {});
  removeCustomPersona(personaId);
  return result;
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
