const BASE = import.meta.env.VITE_API_BASE;

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
	const token = localStorage.getItem("token");
	const headers = new Headers({ "Content-Type": "application/json" });
	if (token) headers.set("Authorization", `Bearer ${token}`);
	const res = await fetch(`${BASE}${path}`, { headers, ...opts });
	if (!res.ok) {
		// normalize errors
		const body = await res.json().catch(() => ({}));
		throw Object.assign(new Error("Request failed"), { status: res.status, body });
	}
	// healthz returns text "ok", handle both text/json safely
	const ct = res.headers.get("content-type") || "";
	if (ct.includes("application/json")) return res.json();
	return (await res.text()) as unknown as T;
}

export const AuthAPI = {
	signup(email: string, password: string) {
		return request<{ message: string }>(`/auth/signup`, {
		method: "POST",
		body: JSON.stringify({ email, password }),
		});
	},
	login(email: string, password: string) {
		return request<{ token: string; user: { id: number; email: string } }>(`/auth/login`, {
		method: "POST",
		body: JSON.stringify({ email, password }),
		}).then((r) => {
		localStorage.setItem("token", r.token);
		return r;
		});
	},
	me() {
		return request<{ ok: boolean; user: { id: number; email: string } }>(`/auth/me`);
	},
};