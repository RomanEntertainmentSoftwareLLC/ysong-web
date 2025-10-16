import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, isAuthed } from "../lib/api";

export default function RequireAuth({ children }: { children: ReactNode }) {
    const [ready, setReady] = useState(!isAuthed());
    const navigate = useNavigate();
    const loc = useLocation();

    useEffect(() => {
        if (!isAuthed()) {
            // no token — go to login with redirect
            navigate(
                `/login?next=${encodeURIComponent(loc.pathname + loc.search)}`,
                { replace: true }
            );
            return;
        }
        // optionally ping /auth/me once to validate token
        api.me().then(
            () => setReady(true),
            () => {
                // bad token -> clear + go login
                localStorage.removeItem("ysong_auth_token");
                navigate(
                    `/login?next=${encodeURIComponent(
                        loc.pathname + loc.search
                    )}`,
                    { replace: true }
                );
            }
        );
    }, []);

    if (!ready) {
        return (
            <div className="min-h-[50vh] grid place-items-center opacity-80 text-sm">
                Checking your session…
            </div>
        );
    }
    return <>{children}</>;
}
