import { apiGet, apiPost } from "./authApi";

export type AccountArtist = { id: string; type: "solo" | "band"; name: string; genre: string; bio: string; members: string; symbol: string; primary: string; accent: string; avatarObjectKey?: string };
export const fetchAccountArtists = () => apiGet<{ artists: AccountArtist[] }>("/api/artists");
export const saveAccountArtist = (artist: AccountArtist) => apiPost<{ ok: true; id: string; avatarObjectKey?: string }>("/api/artists/upsert", artist);
export const deleteAccountArtist = (id: string) => apiPost<{ ok: true; deleted: boolean }>("/api/artists/delete", { id });

export type SingerProfile = { id: string; name: string; description: string; voiceType: string; artistIds: string[]; referenceAudioObjectKey?: string; avatarObjectKey?: string };
export const fetchSingers = () => apiGet<{ singers: SingerProfile[] }>("/api/singers");
export const saveSinger = (singer: SingerProfile) => apiPost<{ ok: true; id: string }>("/api/singers/upsert", singer);
