import { useEffect, useState } from "react";
import { Routes, Route } from "react-router-dom";
import Mobile from "./Mobile";
import Desktop from "./Desktop";
import "./App.css";
import Navbar from "./components/NavBar";
import Legal from "./pages/Legal";
import Privacy from "./pages/Privacy";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Verify from "./pages/Verify";
import ForgotUserName from "./pages/ForgotUserName";
import ForgotPassword from "./pages/ForgotPassword";
import ForgotSent from "./pages/ForgotSent";
import UseGradientBackground from "./components/UseGradientBackground";

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

function App() {
    const isMobile = useMediaQuery("(max-width: 640px)");

    return (
        <>
            <Navbar />
            <UseGradientBackground />
            <div className="pt-16">
                <Routes>
                    <Route
                        path="/"
                        element={isMobile ? <Mobile /> : <Desktop />}
                    />
                    <Route path="/legal" element={<Legal />} />
                    <Route path="/privacy" element={<Privacy />} />
                    <Route path="/login" element={<Login />} />
                    <Route path="/signup" element={<Signup />} />
                    <Route path="verify" element={<Verify />} />
                    <Route
                        path="/forgot-username"
                        element={<ForgotUserName />}
                    />
                    <Route
                        path="/forgot-password"
                        element={<ForgotPassword />}
                    />
                    <Route path="/forgot-sent" element={<ForgotSent />} />
                </Routes>
            </div>
        </>
    );
}

export default App;
