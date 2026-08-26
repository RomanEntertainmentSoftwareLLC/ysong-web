import { AUTH_BASE, apiGet, apiPost } from "./authApi";

export type WorldTrack = {
	id: string;
	releaseId: string;
	ownerUserId: string;
	title: string;
	artistId: string;
	artistName: string;
	albumName: string;
	releaseType: "single" | "album";
	genre: string;
	tags: string[];
	description?: string;
	explicit: boolean;
	trackNumber: number;
	durationSeconds?: number | null;
	playCount: number;
	likes: number;
	dislikes: number;
	myReaction: -1 | 0 | 1;
	publishedAt: string;
	hasArtwork: boolean;
	isOwner: boolean;
	isrc?: string;
	previouslyReleased?: boolean;
	isSaved: boolean;
	isReleaseSaved: boolean;
	isArtistFollowed: boolean;
	commentCount: number;
};

export type WorldRelease = {
	id: string;
	ownerUserId: string;
	artistId?: string;
	artistName: string;
	title: string;
	releaseType: "single" | "album";
	genre: string;
	publishedAt: string;
	hasArtwork: boolean;
	isOwner: boolean;
	isSaved: boolean;
	isArtistFollowed: boolean;
	tracks: WorldTrack[];
};

export type WorldPlaylist = {
	id: string;
	ownerUserId: string;
	ownerName: string;
	title: string;
	description: string;
	tags: string[];
	hasArtwork: boolean;
	isPublic: boolean;
	trackCount: number;
	saveCount: number;
	coverTrackId: string | null;
	isSaved: boolean;
	isOwner: boolean;
	createdAt?: string;
	updatedAt?: string;
};

export type WorldPlaylistDetail = { playlist: WorldPlaylist; tracks: WorldTrack[] };

export type WorldComment = {
	id: string;
	trackId: string;
	parentId: string | null;
	userId: string;
	authorName: string;
	body: string;
	isDeleted: boolean;
	isPinned: boolean;
	likes: number;
	likedByMe: boolean;
	isMine: boolean;
	canModerate: boolean;
	createdAt: string;
	updatedAt: string;
};

export type LibraryRelease = {
	id: string;
	ownerUserId: string;
	artistName: string;
	title: string;
	releaseType: "single" | "album";
	genre: string;
	publishedAt: string;
	hasArtwork: boolean;
	coverTrackId: string | null;
	trackCount: number;
	isSaved: boolean;
};

export type LibraryArtist = { ownerUserId: string; artistName: string; followedAt: string };
export type WorldLibrary = {
	tracks: WorldTrack[];
	releases: LibraryRelease[];
	artists: LibraryArtist[];
	playlists: WorldPlaylist[];
	savedPlaylists: WorldPlaylist[];
	uploads: WorldTrack[];
};

function token() {
	try {
		return localStorage.getItem("ys_token") || localStorage.getItem("ysong_auth_token") || "";
	} catch {
		return "";
	}
}

function activityChanged() {
	window.dispatchEvent(new Event("ysong:notifications-changed"));
	window.dispatchEvent(new Event("ysong:library-changed"));
	window.dispatchEvent(new Event("ysong:achievements-changed"));
}

async function request<T>(path: string, method: "POST" | "PATCH" | "DELETE", body?: Record<string, any>) {
	const res = await fetch(`${AUTH_BASE}${path}`, {
		method,
		headers: {
			...(token() ? { Authorization: `Bearer ${token()}` } : {}),
			...(body ? { "Content-Type": "application/json" } : {}),
		},
		credentials: "include",
		body: body ? JSON.stringify(body) : undefined,
	});
	if (!res.ok) {
		const data = await res.json().catch(() => ({}));
		throw new Error(data?.error || `world_${method.toLowerCase()}_failed`);
	}
	const data = (await res.json().catch(() => ({}))) as T;
	activityChanged();
	return data;
}

export async function uploadWorldAsset(file: File) {
	const form = new FormData();
	form.append("file", file);
	const res = await fetch(`${AUTH_BASE}/api/uploads`, {
		method: "POST",
		headers: token() ? { Authorization: `Bearer ${token()}` } : undefined,
		credentials: "include",
		body: form,
	});
	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		throw new Error(body?.error || "upload_failed");
	}
	return (await res.json()) as { filename: string; size: number; contentType: string; objectKey: string };
}

export async function publishWorldTrack(payload: {
	title: string;
	artistId: string;
	releaseType: "single" | "album";
	albumTitle?: string;
	genre: string;
	tags: string[];
	description?: string;
	explicit: boolean;
	trackNumber: number;
	durationSeconds?: number | null;
	isrc?: string;
	previouslyReleased?: boolean;
	rightsConfirmed: boolean;
	audioObjectKey: string;
	artworkObjectKey?: string | null;
}) {
	const result = await apiPost<{ ok: true; track: WorldTrack; releaseId: string }>("/api/world/publish", payload);
	activityChanged();
	return result;
}

export async function fetchWorldTracks(params?: { search?: string; genre?: string; sort?: string }) {
	const q = new URLSearchParams();
	if (params?.search) q.set("search", params.search);
	if (params?.genre && params.genre !== "all") q.set("genre", params.genre);
	if (params?.sort) q.set("sort", params.sort);
	return apiGet<{ tracks: WorldTrack[]; genres: string[] }>(`/api/world/tracks${q.size ? `?${q}` : ""}`);
}

export function fetchWorldTrack(id: string) {
	return apiGet<{ track: WorldTrack }>(`/api/world/tracks/${encodeURIComponent(id)}`);
}

export function fetchWorldRelease(id: string) {
	return apiGet<WorldRelease>(`/api/world/releases/${encodeURIComponent(id)}`);
}

export function reactToWorldTrack(trackId: string, reaction: -1 | 1) {
	return request<{ ok: true; reaction: -1 | 0 | 1; likes: number; dislikes: number }>(
		`/api/world/tracks/${encodeURIComponent(trackId)}/reaction`, "POST", { reaction }
	);
}

export function toggleWorldTrackSave(trackId: string) {
	return request<{ ok: true; saved: boolean }>(`/api/world/tracks/${encodeURIComponent(trackId)}/save`, "POST", {});
}

export function toggleWorldReleaseSave(releaseId: string) {
	return request<{ ok: true; saved: boolean }>(`/api/world/releases/${encodeURIComponent(releaseId)}/save`, "POST", {});
}

export function toggleWorldArtistFollow(ownerUserId: string, artistName: string) {
	return request<{ ok: true; followed: boolean }>("/api/world/artists/follow", "POST", { ownerUserId, artistName });
}

export async function countWorldPlay(trackId: string) {
	const result = await apiPost<{ ok: true; playCount: number }>(`/api/world/tracks/${encodeURIComponent(trackId)}/play`, {});
	window.dispatchEvent(new Event("ysong:achievements-changed"));
	return result;
}

export function worldAudioUrl(trackId: string) {
	return `${AUTH_BASE}/api/world/media/${encodeURIComponent(trackId)}/audio`;
}

export function worldArtworkUrl(trackId: string) {
	return `${AUTH_BASE}/api/world/media/${encodeURIComponent(trackId)}/cover`;
}

export function worldPlaylistArtworkUrl(playlistId: string) {
	return `${AUTH_BASE}/api/world/playlists/${encodeURIComponent(playlistId)}/artwork`;
}

export function updateWorldTrack(trackId: string, patch: {
	title?: string; genre?: string; tags?: string[]; description?: string; explicit?: boolean;
	trackNumber?: number; isrc?: string; previouslyReleased?: boolean;
}) {
	return request<{ ok: true; track: WorldTrack }>(`/api/world/tracks/${encodeURIComponent(trackId)}`, "PATCH", patch);
}

export function updateWorldRelease(releaseId: string, patch: { artistName?: string; title?: string; genre?: string }) {
	return request<{ ok: true; release: WorldRelease }>(`/api/world/releases/${encodeURIComponent(releaseId)}`, "PATCH", patch);
}

export function removeWorldTrack(trackId: string) {
	return request<{ ok: true; releaseDeleted: boolean; releaseId: string }>(`/api/world/tracks/${encodeURIComponent(trackId)}`, "DELETE");
}

export function removeWorldRelease(releaseId: string) {
	return request<{ ok: true; deleted: boolean }>(`/api/world/releases/${encodeURIComponent(releaseId)}`, "DELETE");
}

export function fetchPublicPlaylists() {
	return apiGet<{ playlists: WorldPlaylist[] }>("/api/world/playlists");
}

export function createWorldPlaylist(payload: { title: string; description?: string; tags?: string[]; artworkObjectKey?: string | null; isPublic?: boolean }) {
	return request<{ ok: true; playlist: WorldPlaylist }>("/api/world/playlists", "POST", payload);
}

export function fetchWorldPlaylist(id: string) {
	return apiGet<WorldPlaylistDetail>(`/api/world/playlists/${encodeURIComponent(id)}`);
}

export function updateWorldPlaylist(id: string, patch: { title?: string; description?: string; tags?: string[]; artworkObjectKey?: string | null; isPublic?: boolean }) {
	return request<{ ok: true }>(`/api/world/playlists/${encodeURIComponent(id)}`, "PATCH", patch);
}

export function deleteWorldPlaylist(id: string) {
	return request<{ ok: true }>(`/api/world/playlists/${encodeURIComponent(id)}`, "DELETE");
}

export function toggleWorldPlaylistSave(id: string) {
	return request<{ ok: true; saved: boolean }>(`/api/world/playlists/${encodeURIComponent(id)}/save`, "POST", {});
}

export function addTrackToWorldPlaylist(playlistId: string, trackId: string) {
	return request<{ ok: true; added: boolean }>(`/api/world/playlists/${encodeURIComponent(playlistId)}/tracks`, "POST", { trackId });
}

export function removeTrackFromWorldPlaylist(playlistId: string, trackId: string) {
	return request<{ ok: true }>(`/api/world/playlists/${encodeURIComponent(playlistId)}/tracks/${encodeURIComponent(trackId)}`, "DELETE");
}

export function reorderWorldPlaylist(playlistId: string, trackIds: string[]) {
	return request<{ ok: true }>(`/api/world/playlists/${encodeURIComponent(playlistId)}/reorder`, "POST", { trackIds });
}

export function fetchWorldComments(trackId: string) {
	return apiGet<{ comments: WorldComment[] }>(`/api/world/tracks/${encodeURIComponent(trackId)}/comments`);
}

export function createWorldComment(trackId: string, body: string, parentId?: string | null) {
	return request<{ ok: true; comment: WorldComment }>(`/api/world/tracks/${encodeURIComponent(trackId)}/comments`, "POST", { body, parentId: parentId || null });
}

export function toggleWorldCommentLike(commentId: string) {
	return request<{ ok: true; liked: boolean; likes: number }>(`/api/world/comments/${encodeURIComponent(commentId)}/like`, "POST", {});
}

export function toggleWorldCommentPin(commentId: string) {
	return request<{ ok: true; pinned: boolean }>(`/api/world/comments/${encodeURIComponent(commentId)}/pin`, "POST", {});
}

export function reportWorldComment(commentId: string, reason = "reported") {
	return request<{ ok: true }>(`/api/world/comments/${encodeURIComponent(commentId)}/report`, "POST", { reason });
}

export function deleteWorldComment(commentId: string) {
	return request<{ ok: true }>(`/api/world/comments/${encodeURIComponent(commentId)}`, "DELETE");
}

export function fetchWorldLibrary() {
	return apiGet<WorldLibrary>("/api/library");
}
