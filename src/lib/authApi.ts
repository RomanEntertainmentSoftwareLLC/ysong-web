export const AUTH_BASE =
  import.meta.env.VITE_AUTH_API_URL ?? "https://api.ysong.ai";

/* Read token from either key (old/new) */
function readToken(): string | null {
  return (
    localStorage.getItem("ys_token") ||
    localStorage.getItem("ysong_auth_token") || // legacy
    null
  );
}

/** Build Authorization header */
function authHeader(): Record<string, string> {
  const t = readToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function handle401(res: Response) {
  if (res.status === 401) {
    // token missing/expired/invalid — clear and bounce to login
    clearToken();
    throw new Error("unauthorized");
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
      ...authHeader(),
    },
    credentials: "include",
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    await handle401(res);
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
    headers: { ...authHeader() },
    credentials: "include",
  });
  if (!res.ok) {
    await handle401(res);
    throw new Error("request_failed");
  }
  return (await res.json().catch(() => ({}))) as T;
}

/** Clear token (logout) */
export function clearToken() {
  localStorage.removeItem("ys_token");
  localStorage.removeItem("ysong_auth_token"); // legacy cleanup
}
