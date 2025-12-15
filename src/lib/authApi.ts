const AUTH_BASE_RAW =
  import.meta.env.VITE_AUTH_API_URL ?? "https://api.ysong.ai";

export const AUTH_BASE = (AUTH_BASE_RAW || "").replace(/\/+$/, "");

const TOKEN_KEY = "ys_token";
const LEGACY_TOKEN_KEY = "ysong_auth_token";

function joinUrl(base: string, path: string) {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

/* Read token from either key (old/new) */
function readToken(): string | null {
  try {
    return (
      localStorage.getItem(TOKEN_KEY) ||
      localStorage.getItem(LEGACY_TOKEN_KEY) ||
      null
    );
  } catch {
    return null;
  }
}

/** Build Authorization header */
function authHeader(): Record<string, string> {
  const t = readToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/** Clear token (logout / reset) */
export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {}
}

/**
 * Shared error handler:
 * - Reads JSON if possible
 * - Handles token-related 401s (invalid/missing/unauthorized)
 * - Throws an Error with a short string code (used in Login.tsx)
 */
async function handleError(res: Response): Promise<never> {
  let errorCode = "request_failed";

  try {
    const data = await res.json().catch(() => null);
    if (data && typeof data === "object" && "error" in data) {
      errorCode = String((data as any).error);
    }
  } catch {
    // keep default errorCode
  }

  // Token-related auth failure = nuke token & mark as unauthorized
  if (
    res.status === 401 &&
    (errorCode === "invalid_token" ||
      errorCode === "missing_token" ||
      errorCode === "unauthorized")
  ) {
    clearToken();

    // Optional: if we're inside the app shell, force re-login
    if (!window.location.pathname.startsWith("/login")) {
      // Full reload to reset any in-memory state
      window.location.replace("/login");
    }

    throw new Error("unauthorized");
  }

  // Otherwise, propagate the specific error code (e.g. invalid_credentials)
  throw new Error(errorCode);
}

/** POST helper (JSON in, JSON out) */
export async function apiPost<T = unknown>(
  path: string,
  body: Record<string, any>
): Promise<T> {
  const res = await fetch(joinUrl(AUTH_BASE, path), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeader(),
    },
    // `credentials: "include"` is only needed if you actually use cookies.
    // You can keep it, but it's not required for pure JWT-in-header auth:
    credentials: "include",
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    await handleError(res);
  }

  // If you ever have 204/empty responses, guard here
  return (await res.json().catch(() => ({}))) as T;
}

/** GET helper (JSON out) */
export async function apiGet<T = unknown>(path: string): Promise<T> {
  const res = await fetch(joinUrl(AUTH_BASE, path), {
    headers: { ...authHeader() },
    credentials: "include",
  });

  if (!res.ok) {
    await handleError(res);
  }

  return (await res.json().catch(() => ({}))) as T;
}
