import { Link } from "react-router-dom";
import { useState } from "react";
import { apiPost } from "../lib/authApi";
import { YSButton } from "../components/YSButton";

export default function ForgotPassword() {
    const [email, setEmail] = useState("");
    const [sending, setSending] = useState(false);
    const [status, setStatus] = useState<null | "ok" | "err">(null);
    const [msg, setMsg] = useState("");

    const onSubmit = async () => {
        const trimmed = email.trim().toLowerCase();
        if (!trimmed) return;
        // simple email check (optional)
        if (!/^\S+@\S+\.\S+$/.test(trimmed)) {
            setStatus("err");
            setMsg("Please enter a valid email.");
            return;
        }

        try {
            setSending(true);
            setStatus(null);
            setMsg("");
            await apiPost("/auth/password/forgot", { email: trimmed });
            // API should always respond 200 with generic message to avoid enumeration
            setStatus("ok");
            setMsg("If that email exists, we’ve sent reset instructions.");
        } catch (e: any) {
            setStatus("err");
            setMsg(e?.message || "Request failed. Try again in a moment.");
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="mx-auto max-w-md px-4 sm:px-6 lg:px-8 py-10">
            <h1 className="text-3xl sm:text-4xl font-bold text-center">
                Forgot Password?
            </h1>
            <p className="mt-3 text-center opacity-80">
                Enter your email and we'll send instructions to recover your
                password.
            </p>

            <section className="mt-8 space-y-4">
                <h2 className="text-lg font-semibold">Reset password</h2>

                <div>
                    <label
                        htmlFor="pw-email"
                        className="block text-sm font-medium mb-1"
                    >
                        Email
                    </label>
                    <input
                        id="pw-email"
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="px-3 py-2 w-full rounded-lg border"
                    />
                </div>

                <YSButton
                    type="button"
                    onClick={onSubmit}
                    disabled={sending || !email}
                    className="w-full px-4 py-2 text-sm font-semibold rounded-lg border disabled:opacity-50"
                >
                    {sending ? "Sending…" : "Email me a reset link"}
                </YSButton>

                {status === "ok" && (
                    <div className="rounded-md border border-emerald-500/30 bg-emerald-50 dark:bg-emerald-900/20 p-3 text-sm">
                        {msg}
                    </div>
                )}
                {status === "err" && (
                    <div className="rounded-md border border-rose-500/30 bg-rose-50 dark:bg-rose-900/10 p-3 text-sm">
                        {msg}
                    </div>
                )}
            </section>

            <p className="mt-6 text-center text-sm">
                <Link
                    to="/login"
                    className="text-indigo-400 hover:text-indigo-300"
                >
                    Back to login
                </Link>
            </p>
        </div>
    );
}
