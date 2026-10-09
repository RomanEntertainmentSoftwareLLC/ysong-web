import type { RoomMessage } from "./roomApi";

export const ROOM_CHAT_LIMIT = 200;
const CACHE_PREFIX = "ysong:rooms:chat-cache:v1:";
const OPT_IN_KEY = "ysong:rooms:chat-cache-enabled:v1";

export function boundRoomMessages(messages: RoomMessage[], limit = ROOM_CHAT_LIMIT): RoomMessage[] {
  const byId = new Map<string, RoomMessage>();
  for (const message of messages) {
    if (!message || typeof message.id !== "string" || typeof message.content !== "string") continue;
    byId.set(message.id, message);
  }
  return [...byId.values()]
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .slice(-Math.max(1, limit));
}

export function isRoomChatCacheEnabled(): boolean {
  try { return localStorage.getItem(OPT_IN_KEY) === "1"; }
  catch { return false; }
}

export function setRoomChatCacheEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(OPT_IN_KEY, "1");
    else {
      localStorage.removeItem(OPT_IN_KEY);
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key?.startsWith(CACHE_PREFIX)) localStorage.removeItem(key);
      }
    }
  } catch { /* The room remains usable without persistent browser storage. */ }
}

export function readRoomChatCache(roomId: string): RoomMessage[] {
  if (!roomId || !isRoomChatCacheEnabled()) return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(`${CACHE_PREFIX}${encodeURIComponent(roomId)}`) || "[]");
    return Array.isArray(parsed) ? boundRoomMessages(parsed as RoomMessage[]) : [];
  } catch { return []; }
}

export function writeRoomChatCache(roomId: string, messages: RoomMessage[]): void {
  if (!roomId || !isRoomChatCacheEnabled()) return;
  try { localStorage.setItem(`${CACHE_PREFIX}${encodeURIComponent(roomId)}`, JSON.stringify(boundRoomMessages(messages))); }
  catch { /* Storage is optional and may be full or unavailable. */ }
}
