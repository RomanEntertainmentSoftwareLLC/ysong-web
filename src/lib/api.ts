// src/lib/api.ts
const RAW_BASE = import.meta.env.VITE_API_URL as string;
// normalize: remove any trailing slash so `${API_BASE}${path}` is safe
export const API_BASE = RAW_BASE.replace(/\/+$/, "");

// --- auth token helpers ---
const TOKEN_KEY = "ysong_auth_token";
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string | null) =>
  t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY);
export const isAuthed = () => !!getToken();

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(init?.headers as Record<string, string> | undefined),
    };

    // attach token if present
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`${API_BASE}${path}`, {
      mode: "cors",
      headers,
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
  // SIGN UP (you already had this)
  signup: (email: string, password: string, name?: string) =>
    request<{ message: string }>("/auth/signup", {
      method: "POST",
      body: JSON.stringify(name ? { email, password, name } : { email, password }),
    }),

  // EMAIL VERIFY (you already had this)
  verify: (token: string, email: string) =>
    request<{ ok: boolean; reason?: string }>(
      `/auth/verify?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`
    ),

  // NEW: LOGIN (expects API to return { token })
  login: async (email: string, password: string) => {
    const data = await request<{ token: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    setToken(data.token);
    return data;
  },

  // NEW: CURRENT USER (expects { id, email, ... })
  me: () =>
    request<{ id: string; email: string; name?: string; email_verified_at?: string }>(
      "/auth/me"
    ),

  // NEW: LOGOUT (client-side)
  logout: () => setToken(null),
};

