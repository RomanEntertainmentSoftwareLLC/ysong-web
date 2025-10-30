export const AUTH_BASE =
	import.meta.env.VITE_AUTH_API_URL ?? "https://api.ysong.ai";

/** Build Authorization header from localStorage, if present */
function authHeader(): Record<string, string> {
	const t = localStorage.getItem("ys_token");
	return t ? { Authorization: `Bearer ${t}` } : {};
}

/** POST helper (JSON in, JSON out) */
export async function apiPost<T = unknown>(
	path: string,
	body: Record<string, any>
): Promise<T> {
	const res = await fetch(`${AUTH_BASE}${path}`, {
		method: "POST",
		headers: {
		"Content-Type": "application/json",
		...authHeader(),              // keep your Bearer token if set
		},
		body: JSON.stringify(body),
		// If you later switch to server-set cookies, leave this ON:
		// credentials tells the browser it's allowed to send/receive cookies.
		credentials: "include",
	});

	if (!res.ok) {
		let err = "request_failed";
		try {
		const j = await res.json();
		err = (j as any)?.error ?? err;
		} catch {}
		throw new Error(err);
	}
  	return (await res.json().catch(() => ({}))) as T;
}

/** GET helper (JSON out) */
export async function apiGet<T = unknown>(path: string): Promise<T> {
	const res = await fetch(`${AUTH_BASE}${path}`, {
		headers: {
		...authHeader(),              // send Bearer if present
		},
		credentials: "include",
	});
	if (!res.ok) throw new Error("request_failed");
	return (await res.json().catch(() => ({}))) as T;
}

/** Clear token (logout) */
export function clearToken() {
	localStorage.removeItem("ys_token");
}