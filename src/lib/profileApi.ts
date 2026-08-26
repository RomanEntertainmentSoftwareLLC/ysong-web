import { AUTH_BASE, apiGet } from "./authApi";

function token() {
	try { return localStorage.getItem("ys_token") || localStorage.getItem("ysong_auth_token") || ""; } catch { return ""; }
}

export async function uploadProfileAsset(file: File) {
	const form = new FormData();
	form.append("file", file);
	const res = await fetch(`${AUTH_BASE}/api/uploads`, { method: "POST", headers: token() ? { Authorization: `Bearer ${token()}` } : undefined, credentials: "include", body: form });
	if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "upload_failed");
	return await res.json() as { objectKey: string; filename: string; contentType: string; size: number };
}

export async function signedProfileAssetUrl(objectKey?: string | null) {
	if (!objectKey) return "";
	const q = new URLSearchParams({ objectKey, mode: "play" });
	const data = await apiGet<{ url: string }>(`/api/uploads/signed-url?${q.toString()}`);
	return data.url || "";
}
