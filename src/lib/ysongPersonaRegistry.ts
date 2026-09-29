/**
 * Canonical persona model and browser registry.
 * Artwork is referenced by asset path; it is intentionally independent from
 * persona behavior and capabilities.
 */
export type PersonaCapabilities = {
  chat: boolean;
  rooms: boolean;
  daw: boolean;
  musicCreation: boolean;
};

export type PersonaAssets = {
  portrait?: string;
  avatar?: string;
};

export type PersonaRecord = {
  id: string;
  kind: "builtin" | "custom";
  display: {
    name: string;
    description: string;
    specialty: string;
  };
  behavior: {
    humorStyle: string;
    instructions?: string;
    socialEnergy: number;
    critiqueLevel: number;
  };
  capabilities: PersonaCapabilities;
  assets: PersonaAssets;
  sortOrder: number;
  createdAt?: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
};

export const DEFAULT_PERSONA_ID = "persona_surfer_v1";
const CUSTOM_PERSONAS_STORAGE_KEY = "ysong:personas:custom:v1";

const DEFAULT_CAPABILITIES: PersonaCapabilities = {
  chat: true,
  rooms: true,
  daw: false,
  musicCreation: false,
};

export const BUILT_IN_PERSONAS: readonly PersonaRecord[] = [
  {
    id: DEFAULT_PERSONA_ID,
    kind: "builtin",
    display: { name: "Surfer Dude", description: "The built-in YSong assistant.", specialty: "Music and production" },
    behavior: { humorStyle: "Light and playful", socialEnergy: 0.6, critiqueLevel: 0.6 },
    capabilities: { ...DEFAULT_CAPABILITIES },
    assets: { portrait: "/ai-personas/surfer-dude.png", avatar: "/ai-personas/surfer-dude.png" },
    sortOrder: 0,
  },
  {
    id: "persona_goth_girl_v1",
    kind: "builtin",
    display: { name: "Goth Girl", description: "A darkly playful music companion.", specialty: "Music and production" },
    behavior: { humorStyle: "Dry and darkly playful", socialEnergy: 0.5, critiqueLevel: 0.6 },
    capabilities: { ...DEFAULT_CAPABILITIES },
    assets: { portrait: "/ai-personas/goth-girl.png", avatar: "/ai-personas/goth-girl.png" },
    sortOrder: 1,
  },
  {
    id: "persona_pop_princess_v1",
    kind: "builtin",
    display: { name: "Pop Princess", description: "A bright, stage-ready music companion.", specialty: "Pop music and performance" },
    behavior: { humorStyle: "Warm and sparkling", socialEnergy: 0.8, critiqueLevel: 0.5 },
    capabilities: { ...DEFAULT_CAPABILITIES },
    assets: { portrait: "/ai-personas/pop-princess.png", avatar: "/ai-personas/pop-princess.png" },
    sortOrder: 2,
  },
];

function isPersonaRecord(value: unknown): value is PersonaRecord {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<PersonaRecord>;
  return typeof item.id === "string" && item.id.length > 0 && item.kind === "custom"
    && typeof item.display?.name === "string" && typeof item.behavior?.socialEnergy === "number"
    && typeof item.capabilities?.chat === "boolean" && typeof item.assets === "object";
}

function readCustomPersonas(): PersonaRecord[] {
  try {
    const raw = localStorage.getItem(CUSTOM_PERSONAS_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isPersonaRecord) : [];
  } catch {
    return [];
  }
}

function writeCustomPersonas(personas: PersonaRecord[]) {
  try {
    localStorage.setItem(CUSTOM_PERSONAS_STORAGE_KEY, JSON.stringify(personas));
  } catch {
    // Registry remains usable in memory-only or storage-restricted contexts.
  }
}

export function listRegisteredPersonas(): PersonaRecord[] {
  const custom = readCustomPersonas();
  const byId = new Map<string, PersonaRecord>();
  for (const persona of [...BUILT_IN_PERSONAS, ...custom]) byId.set(persona.id, persona);
  return [...byId.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.display.name.localeCompare(b.display.name));
}

export function getRegisteredPersona(id: string): PersonaRecord | undefined {
  return listRegisteredPersonas().find((persona) => persona.id === id);
}

export function saveCustomPersona(persona: PersonaRecord): PersonaRecord {
  if (persona.kind !== "custom") throw new Error("Only custom personas can be saved in this registry.");
  if (!persona.id.trim()) throw new Error("Persona ID is required.");
  if (BUILT_IN_PERSONAS.some((builtIn) => builtIn.id === persona.id)) throw new Error("Persona ID is reserved.");
  const existing = readCustomPersonas().filter((item) => item.id !== persona.id);
  const saved = { ...persona, display: { ...persona.display }, behavior: { ...persona.behavior }, capabilities: { ...persona.capabilities }, assets: { ...persona.assets } };
  writeCustomPersonas([...existing, saved]);
  return saved;
}

export function removeCustomPersona(id: string): boolean {
  const existing = readCustomPersonas();
  const remaining = existing.filter((persona) => persona.id !== id);
  if (remaining.length === existing.length) return false;
  writeCustomPersonas(remaining);
  return true;
}
