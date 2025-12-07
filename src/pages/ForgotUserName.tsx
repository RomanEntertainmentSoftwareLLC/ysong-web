// src/pages/ForgotUserName.tsx
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiPost } from "../lib/authApi";
import { YSButton } from "../components/YSButton";

export default function ForgotUserName() {
    const [email, setEmail] = useState("");
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const navigate = useNavigate();

    async function handleSend() {
        setError(null);
        if (!email) return;

        setSending(true);
        try {
            // Backend route on ysong-auth: POST /auth/username/remind { email }
            await apiPost("/auth/username/remind", { email });
            navigate(`/forgot-sent?email=${encodeURIComponent(email)}`);
        } catch (e: any) {
            setError(e?.message || "Could not send email. Try again.");
        } finally {
            setSending(false);
        }
    }

    return (
        <div className="mx-auto max-w-md px-4 sm:px-6 lg:px-8 py-10">
            <h1 className="text-2xl sm:text-3xl font-bold">Forgot username</h1>
            <p className="mt-2 text-sm opacity-80">
                Enter the email associated with your account. If it exists,
                we’ll send you a reminder with your username.
            </p>

            <div className="mt-6 space-y-3">
                <label className="block text-sm font-medium">Email</label>
                <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) =>
                        e.key === "Enter" && !sending && handleSend()
                    }
                    placeholder="you@example.com"
                    className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700
                     bg-white dark:bg-neutral-900 px-3 py-2 focus:outline-none
                     focus:ring-2 focus:ring-sky-500"
                    autoFocus
                />

                {error && (
                    <div className="text-sm text-rose-500 mt-1">{error}</div>
                )}

                <div className="mt-4 flex items-center gap-2">
                    <YSButton
                        type="button"
                        onClick={handleSend}
                        disabled={sending || !email}
                        className="px-3.5 py-2 text-sm font-medium rounded-lg border
                       disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                        {sending ? "Sending…" : "Send username"}
                    </YSButton>

                    <Link
                        to="/login"
                        className="text-sm opacity-80 hover:opacity-100 hover:underline"
                    >
                        Back to login
                    </Link>
                </div>
            </div>
        </div>
    );
}
