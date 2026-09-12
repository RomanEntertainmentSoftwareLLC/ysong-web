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
  liveActive?: boolean;
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
  metadata?: Record<string, unknown>;
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
export async function requestRoomAi(id: string, triggerText: string, mentionedPersonaIds: string[] = []) { return apiPost<{ messages: RoomMessage[]; selectedPersonaIds: string[] }>(`/api/rooms/${encodeURIComponent(id)}/ai/respond`, { triggerText, mentionedPersonaIds }); }


export type RoomVenueMode = "listening" | "radio" | "visual" | "performance";
export type RoomAudienceEffectId = "applause" | "hearts" | "confetti" | "lightning" | "fire" | "snow" | "camera-shake" | "strobe";

export type RoomVenueTransport = {
  source?: "world" | "daw" | "none";
  playing: boolean;
  positionSeconds: number;
  durationSeconds: number;
  trackId?: string;
  title?: string;
  artist?: string;
  album?: string;
  broadcastProgramId?: string;
  broadcastProgramName?: string;
  broadcastKind?: "playlist" | "radio" | "ad-hoc";
  visualSceneId?: string;
  visualSceneName?: string;
  nextTrackId?: string;
  nextTitle?: string;
  nextArtist?: string;
  adBreakActive?: boolean;
  updatedAt: number;
};

export type RoomVenueState = {
  roomId: string;
  active: boolean;
  hostUserId: string | null;
  hostName: string;
  mode: RoomVenueMode;
  stageTitle: string;
  stageSubtitle: string;
  streamMode: "none" | "embed";
  streamUrl: string;
  streamLabel: string;
  requestsEnabled: boolean;
  votesEnabled: boolean;
  audienceEffectsEnabled: boolean;
  effectCooldownSeconds: number;
  transport: RoomVenueTransport | null;
  startedAt: string | null;
  updatedAt: string;
};

export type RoomAudienceEvent = {
  id: string;
  roomId: string;
  actorUserId: string | null;
  actorName: string;
  kind: "reaction" | "effect" | "system";
  payload: Record<string, unknown>;
  createdAt: string;
};

export type RoomTrackRequest = {
  id: string;
  roomId: string;
  requesterUserId: string;
  requesterName: string;
  trackId: string | null;
  title: string;
  artist: string;
  status: "pending" | "approved" | "rejected" | "played";
  votes: number;
  myVote: boolean;
  createdAt: string;
  updatedAt: string;
};

export type RoomPollOption = { id: string; label: string; votes: number };
export type RoomPoll = {
  id: string;
  roomId: string;
  question: string;
  options: RoomPollOption[];
  myOptionId: string | null;
  status: "open" | "closed";
  createdByUserId: string;
  createdByName: string;
  closesAt: string | null;
  createdAt: string;
};

export type RoomVenueSnapshot = {
  venue: RoomVenueState;
  events: RoomAudienceEvent[];
  requests: RoomTrackRequest[];
  poll: RoomPoll | null;
  serverNow: number;
};

export function getRoomVenue(id: string, since?: string) {
  const q = since ? `?since=${encodeURIComponent(since)}` : "";
  return apiGet<RoomVenueSnapshot>(`/api/rooms/${encodeURIComponent(id)}/venue${q}`);
}
export function updateRoomVenue(id: string, patch: Partial<Pick<RoomVenueState,"active"|"mode"|"stageTitle"|"stageSubtitle"|"streamMode"|"streamUrl"|"streamLabel"|"requestsEnabled"|"votesEnabled"|"audienceEffectsEnabled"|"effectCooldownSeconds">>) {
  return apiPost<{ venue: RoomVenueState }>(`/api/rooms/${encodeURIComponent(id)}/venue/settings`, patch as Record<string,any>);
}
export function publishRoomVenueTransport(id: string, transport: RoomVenueTransport) {
  return apiPost<{ ok: true; venue: RoomVenueState }>(`/api/rooms/${encodeURIComponent(id)}/venue/transport`, { transport });
}
export function sendRoomReaction(id: string, emoji: string) {
  return apiPost<{ event: RoomAudienceEvent }>(`/api/rooms/${encodeURIComponent(id)}/venue/reaction`, { emoji });
}
export function sendRoomAudienceEffect(id: string, effectId: RoomAudienceEffectId) {
  return apiPost<{ event: RoomAudienceEvent; cooldownRemainingSeconds: number }>(`/api/rooms/${encodeURIComponent(id)}/venue/effect`, { effectId });
}
export function createRoomTrackRequest(id: string, input: { trackId?: string | null; title: string; artist?: string }) {
  return apiPost<{ request: RoomTrackRequest }>(`/api/rooms/${encodeURIComponent(id)}/venue/requests`, input);
}
export function voteRoomTrackRequest(id: string, requestId: string) {
  return apiPost<{ request: RoomTrackRequest }>(`/api/rooms/${encodeURIComponent(id)}/venue/requests/${encodeURIComponent(requestId)}/vote`, {});
}
export function moderateRoomTrackRequest(id: string, requestId: string, status: RoomTrackRequest["status"]) {
  return apiPost<{ request: RoomTrackRequest }>(`/api/rooms/${encodeURIComponent(id)}/venue/requests/${encodeURIComponent(requestId)}/status`, { status });
}
export function createRoomPoll(id: string, question: string, options: string[], durationSeconds = 0) {
  return apiPost<{ poll: RoomPoll }>(`/api/rooms/${encodeURIComponent(id)}/venue/polls`, { question, options, durationSeconds });
}
export function voteRoomPoll(id: string, pollId: string, optionId: string) {
  return apiPost<{ poll: RoomPoll }>(`/api/rooms/${encodeURIComponent(id)}/venue/polls/${encodeURIComponent(pollId)}/vote`, { optionId });
}
export function closeRoomPoll(id: string, pollId: string) {
  return apiPost<{ poll: RoomPoll }>(`/api/rooms/${encodeURIComponent(id)}/venue/polls/${encodeURIComponent(pollId)}/close`, {});
}
