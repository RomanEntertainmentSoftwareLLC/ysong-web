import { useEffect, useState } from "react";
import { Routes, Route, Outlet, useLocation } from "react-router-dom";

import Mobile from "./Mobile";
import Desktop from "./Desktop";
import Navbar from "./components/NavBar";
import UINavbar from "./components/UINavBar";

import Legal from "./pages/Legal";
import Privacy from "./pages/Privacy";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Verify from "./pages/Verify";
import ForgotUserName from "./pages/ForgotUserName";
import ForgotPassword from "./pages/ForgotPassword";
import ForgotSent from "./pages/ForgotSent";

import UseGradientBackground from "./components/UseGradientBackground";
import RequireAuth from "./components/RequireAuth";
import UI from "./pages/UI";
import TermsOfService from "./pages/TermsOfService";
import TosGate from "./components/ToSGate";
import { ensureSaveChatsDefault } from "./lib/settings";
import { apiGet, apiPost } from "./lib/authApi";

type CurrentUser = {
    id: string;
    email: string;
    tosAcceptedAt?: string | null;
    tosAcceptedVersion?: string | null;
    currentTosVersion?: string | null;
};

function useMediaQuery(query: string) {
    const get = () =>
        typeof window !== "undefined" && window.matchMedia(query).matches;
    const [matches, setMatches] = useState<boolean>(get());

    useEffect(() => {
        if (typeof window === "undefined") return;
        const mql = window.matchMedia(query);
        const onChange = () => setMatches(mql.matches);
        mql.addEventListener("change", onChange);
        setMatches(mql.matches);
        return () => mql.removeEventListener("change", onChange);
    }, [query]);

    return matches;
}

/** Shell that chooses which header to show and preserves the header offset */
function AppShell() {
    const location = useLocation();
    const inApp = location.pathname.startsWith("/app");

    return (
        <>
            {inApp ? <UINavbar /> : <Navbar />}
            <UseGradientBackground />
            {/* keep content pushed below 4rem header */}
            <div className="pt-16">
                <Outlet />
            </div>
        </>
    );
}

function App() {
    const isMobile = useMediaQuery("(max-width: 640px)");
    const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);

    // Helper we can reuse (e.g. after accepting ToS)
    async function refetchMe() {
        try {
            const res = await apiGet<{ ok: boolean; user: CurrentUser }>(
                "/auth/me"
            );
            setCurrentUser(res.user);
        } catch {
            // ignore; user might be logged out
        }
    }

    // Initial fetch of the signed-in user
    useEffect(() => {
        const token =
            localStorage.getItem("ys_token") ||
            localStorage.getItem("ysong.token"); // legacy fallback

        if (!token) return; // <- don't call /auth/me when logged out
        refetchMe();
    }, []);

    // Set your “save chats” default (OFF)
    useEffect(() => {
        ensureSaveChatsDefault(false);
    }, []);

    // ---- ToS anon → per-user key migration -----------------------------------
    // If an older session stored `ysong.tos.accepted.<ver>.anon` and we now know
    // the real userId, move that flag to the user-specific key so a different
    // account on the same browser doesn’t get blocked.
    useEffect(() => {
        if (!currentUser?.id) return;

        const ver = currentUser.currentTosVersion || "v0";
        const userKey = `ysong.tos.accepted.${ver}.${currentUser.id}`;

        const localAccepted = localStorage.getItem(userKey) === "1";
        const serverAccepted =
            !!currentUser.tosAcceptedAt &&
            !!currentUser.tosAcceptedVersion &&
            currentUser.tosAcceptedVersion === currentUser.currentTosVersion;

        if (localAccepted && !serverAccepted) {
            apiPost("/auth/accept-tos", {})
                .then(() => refetchMe())
                .catch(() => {});
        }
    }, [
        currentUser?.id,
        currentUser?.currentTosVersion,
        currentUser?.tosAcceptedAt,
        currentUser?.tosAcceptedVersion,
    ]);
    // ---------------------------------------------------------------------------

    return (
        <Routes>
            {/* Everything renders inside the shell so the correct header shows */}
            <Route element={<AppShell />}>
                <Route path="/" element={isMobile ? <Mobile /> : <Desktop />} />
                <Route path="/legal" element={<Legal />} />
                <Route path="/privacy" element={<Privacy />} />
                <Route path="/login" element={<Login />} />
                <Route path="/signup" element={<Signup />} />
                <Route path="/verify" element={<Verify />} />
                <Route path="/forgot-username" element={<ForgotUserName />} />
                <Route path="/forgot-password" element={<ForgotPassword />} />
                <Route path="/forgot-sent" element={<ForgotSent />} />
                <Route path="/terms-of-service" element={<TermsOfService />} />

                <Route
                    path="/app"
                    element={
                        <RequireAuth>
                            <TosGate
                                userAcceptedAt={currentUser?.tosAcceptedAt}
                                userAcceptedVersion={
                                    currentUser?.tosAcceptedVersion
                                }
                                currentVersion={currentUser?.currentTosVersion}
                                userId={currentUser?.id}
                                onAccepted={refetchMe} // refresh /auth/me after accept
                            >
                                <UI />
                            </TosGate>
                        </RequireAuth>
                    }
                />
            </Route>
        </Routes>
    );
}

export default App;
