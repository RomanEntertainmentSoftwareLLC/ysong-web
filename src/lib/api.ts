const RAW_BASE = import.meta.env.VITE_API_URL as string;
// normalize: remove any trailing slash so `${API_BASE}${path}` is safe
export const API_BASE = RAW_BASE.replace(/\/+$/, "");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      mode: "cors",
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

    return (await res.json()) as T;
  } catch (err: any) {
    // Make CORS/network issues clearer in the UI
    if (err?.name === "TypeError") {
      throw new Error("Network/CORS error: request could not reach the server.");
    }
    throw err;
  }
}

export const api = {
  signup: (email: string, password: string, name?: string) =>
    request<{ message: string }>("/auth/signup", {
      method: "POST",
      body: JSON.stringify(name ? { email, password, name } : { email, password }),
    }),

  verify: (token: string, email: string) =>
    request<{ ok: boolean; reason?: string }>(
      `/auth/verify?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`
    ),
};
