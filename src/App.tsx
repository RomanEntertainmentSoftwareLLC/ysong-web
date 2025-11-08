import { useEffect, useState } from "react";
import { Routes, Route, Outlet, useLocation } from "react-router-dom";

import Mobile from "./Mobile";
import Desktop from "./Desktop";
import "./App.css";

import Navbar from "./components/NavBar";
import UINavbar from "./components/UINavBar"; // <-- new in-app navbar

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
import { apiGet } from "./lib/authApi";

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

    useEffect(() => {
        // this hits the API base and includes Authorization automatically
        apiGet<{ ok: boolean; user: CurrentUser }>("/auth/me")
            .then((res) => setCurrentUser(res.user))
            .catch(() => {
                // leave currentUser as null if the call fails
            });
    }, []);

    useEffect(() => {
        ensureSaveChatsDefault(false); // default OFF
    }, []);

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
                                onAccepted={() => {
                                    /* e.g., refetch /auth/me */
                                }}
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
