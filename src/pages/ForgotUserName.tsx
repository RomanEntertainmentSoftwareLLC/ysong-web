import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

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
            const res = await fetch("/api/send-emails", {
                // ← match your file name
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ to: email }),
            });

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data?.error || "Failed to send email");
            }

            // go to confirmation page and pass the email in the URL
            navigate(`/forgot-sent?email=${encodeURIComponent(email)}`);
        } catch (e: any) {
            setError(e.message || "Could not send email. Try again.");
        } finally {
            setSending(false);
        }
    }

    return (
        <div className="mx-auto max-w-md px-4 sm:px-6 lg:px-8 py-10">
            <h1 className="text-3xl sm:text-4xl font-bold text-center">
                Forgot Username?
            </h1>
            <p className="mt-3 text-center opacity-80">
                Enter your email and we'll send instructions to recover your
                username.
            </p>

            <section className="mt-8 space-y-4">
                <h2 className="text-lg font-semibold">Recover username</h2>

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
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        className="px-3 py-2 w-full rounded-lg border"
                    />
                </div>

                <button
                    type="button"
                    onClick={handleSend}
                    disabled={!email || sending}
                    className="w-full px-4 py-2 text-sm font-semibold rounded-lg border disabled:opacity-60"
                >
                    {sending ? "Sending..." : "Email me a link"}
                </button>

                {error && <p className="text-sm text-red-500">{error}</p>}
            </section>

            <p className="mt-6 text-center text-sm">
                <Link to="/login">Back to login</Link>
            </p>
        </div>
    );
}
