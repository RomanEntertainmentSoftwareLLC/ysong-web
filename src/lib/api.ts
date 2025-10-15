export const API_BASE = import.meta.env.VITE_API_URL as string;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {}
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  // ⬇⬇⬇ now accepts name?: string
  signup: (email: string, password: string, name?: string) =>
    request<{ message: string }>("/auth/signup", {
      method: "POST",
      body: JSON.stringify(
        name ? { email, password, name } : { email, password }
      ),
    }),

  verify: (token: string, email: string) =>
    request<{ ok: boolean; reason?: string }>(
      `/auth/verify?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`
    ),
};
