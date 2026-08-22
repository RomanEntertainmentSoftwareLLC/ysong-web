import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiGet, AuthError } from "../lib/authApi";

export default function RequireAuth({ children }: { children: ReactNode }) {
  const nav = useNavigate();
  const loc = useLocation();
  const [ready, setReady] = useState(false);
  const [waitingForServer, setWaitingForServer] = useState(false);

  useEffect(() => {
    let alive = true;
    let timer: number | null = null;

    const goLogin = () => {
      nav(`/login${loc.search || ""}`, {
        replace: true,
        state: { from: `${loc.pathname}${loc.search || ""}` },
      });
    };

    const check = async () => {
      if (!alive) return;
      const token = localStorage.getItem("ys_token") || localStorage.getItem("ysong_auth_token");
      if (!token) {
        goLogin();
        return;
      }

      try {
        await apiGet("/auth/me");
        if (!alive) return;
        setWaitingForServer(false);
        setReady(true);
      } catch (err) {
        if (!alive) return;
        // A real 401/403 means the session is invalid. A connection refusal while
        // START-YSONG is still waking the local API is NOT a logout: keep the user
        // on /app and retry instead of dumping all cockpit windows onto /login.
        if (err instanceof AuthError) {
          goLogin();
          return;
        }
        setWaitingForServer(true);
        timer = window.setTimeout(check, 750);
      }
    };

    check();
    return () => {
      alive = false;
      if (timer != null) window.clearTimeout(timer);
    };
  }, [nav, loc.pathname, loc.search]);

  if (!ready) {
    return (
      <div className="min-h-screen grid place-items-center bg-neutral-950 text-neutral-100">
        <div className="rounded-xl border border-white/10 bg-white/[0.03] px-5 py-4 text-center shadow-xl">
          <div className="text-sm font-semibold">Opening YSong…</div>
          <div className="mt-1 text-xs opacity-55">
            {waitingForServer ? "Local server is waking up. Retrying…" : "Checking your saved session…"}
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
