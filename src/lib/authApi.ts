export const AUTH_BASE =
	import.meta.env.VITE_AUTH_API_URL ?? "https://api.ysong.ai";

export async function apiPost<T = unknown>(
	path: string,
	body: Record<string, any>
	): Promise<T> {
	const res = await fetch(`${AUTH_BASE}${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	if (!res.ok) {
		let err = "request_failed";
		try {
		const j = await res.json();
		err = j?.error ?? err;
		} catch {}
		throw new Error(err);
	}
	return (await res.json().catch(() => ({}))) as T;
}

export async function apiGet<T = unknown>(path: string): Promise<T> {
	const res = await fetch(`${AUTH_BASE}${path}`);
	if (!res.ok) throw new Error("request_failed");
	return (await res.json().catch(() => ({}))) as T;
}