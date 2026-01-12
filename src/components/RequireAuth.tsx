import type { ReactNode } from "react";
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiGet } from "../lib/authApi";

export default function RequireAuth({ children }: { children: ReactNode }) {
	const nav = useNavigate();
	const loc = useLocation();

	useEffect(() => {
		let alive = true;
		(async () => {
			try {
				await apiGet("/auth/me"); // or "/auth/session" if that’s your endpoint
				if (!alive) return;
				// OK -> stay
			} catch {
				if (!alive) return;
				nav("/login", { replace: true, state: { from: loc.pathname } });
			}
		})();
		return () => {
			alive = false;
		};
	}, [nav, loc]);

	return <>{children}</>;
}
