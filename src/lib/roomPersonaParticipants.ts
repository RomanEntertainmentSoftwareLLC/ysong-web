import { getRegisteredPersona, type PersonaRecord } from "./ysongPersonaRegistry";

export type RoomPersonaSlot = {
  personaId: string;
  name: string;
  kind: PersonaRecord["kind"];
  addedAt: string;
};

export type RoomVirtualParticipant = RoomPersonaSlot & {
  specialty: string;
  avatarPath: string;
  status: "identity_only" | "unavailable";
};

const STORAGE_PREFIX = "ysong:rooms:persona-slots:v1:";
const memory = new Map<string, RoomPersonaSlot[]>();

function storageKey(roomId: string) { return `${STORAGE_PREFIX}${roomId}`; }

export function listRoomPersonaSlots(roomId: string): RoomPersonaSlot[] {
  if (!roomId) return [];
  try {
    const raw = localStorage.getItem(storageKey(roomId));
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((item): item is RoomPersonaSlot =>
        !!item && typeof item === "object" && typeof item.personaId === "string"
        && typeof item.name === "string" && (item.kind === "builtin" || item.kind === "custom")
        && typeof item.addedAt === "string") : [];
    }
  } catch { /* Keep slots usable when browser storage is restricted. */ }
  return memory.get(roomId) || [];
}

function save(roomId: string, slots: RoomPersonaSlot[]) {
  memory.set(roomId, slots);
  try { localStorage.setItem(storageKey(roomId), JSON.stringify(slots)); }
  catch { /* Keep the current session usable. */ }
  window.dispatchEvent(new CustomEvent("ysong:room-personas-changed", { detail: { roomId } }));
}

export function addRoomPersonaSlot(roomId: string, personaId: string): RoomPersonaSlot {
  if (!roomId) throw new Error("Open a room first.");
  const persona = getRegisteredPersona(personaId);
  if (!persona || !persona.capabilities.rooms) throw new Error("This persona is unavailable for Rooms.");
  const slots = listRoomPersonaSlots(roomId);
  const existing = slots.find((slot) => slot.personaId === personaId);
  if (existing) return existing;
  const slot = { personaId, name: persona.display.name, kind: persona.kind, addedAt: new Date().toISOString() };
  save(roomId, [...slots, slot]);
  return slot;
}

export function removeRoomPersonaSlot(roomId: string, personaId: string) {
  save(roomId, listRoomPersonaSlots(roomId).filter((slot) => slot.personaId !== personaId));
}

export function listRoomVirtualParticipants(roomId: string): RoomVirtualParticipant[] {
  return listRoomPersonaSlots(roomId).map((slot) => {
    const persona = getRegisteredPersona(slot.personaId);
    const available = !!persona?.capabilities.rooms;
    return {
      ...slot,
      name: available ? persona.display.name : slot.name,
      specialty: available ? persona.display.specialty : "Persona unavailable",
      avatarPath: available && persona.artworkStatus === "approved"
        ? persona.assets.avatar || persona.assets.portrait || "" : "",
      status: available ? "identity_only" : "unavailable",
    };
  });
}
