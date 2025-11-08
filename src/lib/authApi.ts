export const AUTH_BASE =
  import.meta.env.VITE_AUTH_API_URL ?? "https://api.ysong.ai";

/** All places we might store the JWT (compat with older keys) */
const TOKEN_KEYS = [
  "ys_token",             // current
  "ysong_auth_token",     // legacy/alternate
  "ysong.token",          // legacy/alternate
  "token",                // last-resort
];

/** Read token from localStorage OR sessionStorage */
function getToken(): string | null {
  for (const store of [localStorage, sessionStorage]) {
    for (const k of TOKEN_KEYS) {
      const v = store.getItem(k);
      if (v && v.trim()) return v;
    }
  }
  return null;
}

/** Build Authorization header from stored token, if present */
function authHeader(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/** Persist token in both places (call this after /auth/login) */
export function setToken(token: string) {
  localStorage.setItem("ys_token", token);
  localStorage.setItem("ysong_auth_token", token);
  // keep sessionStorage in sync too (optional but handy)
  sessionStorage.setItem("ys_token", token);
  sessionStorage.setItem("ysong_auth_token", token);
}

/** Clear token everywhere (logout) */
export function clearToken() {
  for (const k of TOKEN_KEYS) {
    localStorage.removeItem(k);
    sessionStorage.removeItem(k);
  }
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
      ...authHeader(),           // attach Bearer if we have one
    },
    body: JSON.stringify(body),
    // Safe to keep on even if you switch to cookie auth later:
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
      ...authHeader(),           // attach Bearer if we have one
    },
    credentials: "include",
  });
  if (!res.ok) throw new Error(String(res.status || "request_failed"));
  return (await res.json().catch(() => ({}))) as T;
}
