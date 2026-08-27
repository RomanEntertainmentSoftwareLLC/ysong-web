import { apiGet, apiPost } from "./authApi";
import type { Persona } from "./personaApi";

export type RoomSummary = {
  id: string;
  name: string;
  description: string;
  visibility: "public" | "private";
  ownerUserId: string;
  role: "owner" | "admin" | "member" | null;
  joined: boolean;
  createdAt: string;
  updatedAt: string;
};

export type RoomMember = { userId: string; name: string; role: "owner" | "admin" | "member"; joinedAt: string };
export type RoomPersona = Persona & { participationMode: "active" | "listening" | "mention_only" | "muted"; addedAt?: string };
export type RoomMessage = {
  id: string;
  roomId: string;
  senderKind: "user" | "persona" | "system";
  senderUserId?: string | null;
  senderPersonaId?: string | null;
  senderName: string;
  personaAvatarPath?: string;
  content: string;
  replyToMessageId?: string | null;
  metadata?: Record<string, any>;
  createdAt: string;
};

export type RoomDetail = { room: RoomSummary; members: RoomMember[]; personas: RoomPersona[]; messages: RoomMessage[] };

export async function listRooms() { return apiGet<{ rooms: RoomSummary[] }>("/api/rooms"); }
export async function createRoom(input: { name: string; description?: string; visibility: "public" | "private" }) { return apiPost<{ room: RoomSummary }>("/api/rooms", input); }
export async function getRoom(id: string) { return apiGet<RoomDetail>(`/api/rooms/${encodeURIComponent(id)}`); }
export async function joinRoom(id: string) { return apiPost(`/api/rooms/${encodeURIComponent(id)}/join`, {}); }
export async function leaveRoom(id: string) { return apiPost(`/api/rooms/${encodeURIComponent(id)}/leave`, {}); }
export async function deleteRoom(id: string) { return apiPost(`/api/rooms/${encodeURIComponent(id)}/delete`, {}); }
export async function updateRoom(id: string, input: Partial<Pick<RoomSummary, "name" | "description" | "visibility">>) { return apiPost<{ room: RoomSummary }>(`/api/rooms/${encodeURIComponent(id)}/settings`, input); }
export async function inviteRoomMember(id: string, displayName: string) { return apiPost(`/api/rooms/${encodeURIComponent(id)}/members/invite`, { displayName }); }
export async function addRoomPersona(id: string, personaId: string, participationMode: RoomPersona["participationMode"] = "active") { return apiPost(`/api/rooms/${encodeURIComponent(id)}/personas`, { personaId, participationMode }); }
export async function removeRoomPersona(id: string, personaId: string) { return apiPost(`/api/rooms/${encodeURIComponent(id)}/personas/remove`, { personaId }); }
export async function setRoomPersonaMode(id: string, personaId: string, participationMode: RoomPersona["participationMode"]) { return apiPost(`/api/rooms/${encodeURIComponent(id)}/personas/mode`, { personaId, participationMode }); }
export async function sendRoomMessage(id: string, content: string, replyToMessageId?: string | null) { return apiPost<{ message: RoomMessage }>(`/api/rooms/${encodeURIComponent(id)}/messages`, { content, replyToMessageId: replyToMessageId || null }); }
export async function requestRoomAi(id: string, triggerText: string) { return apiPost<{ messages: RoomMessage[]; selectedPersonaIds: string[] }>(`/api/rooms/${encodeURIComponent(id)}/ai/respond`, { triggerText }); }
