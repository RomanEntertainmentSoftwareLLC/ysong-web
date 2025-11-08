import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiPost } from "../lib/authApi";
import { clearToken } from "../lib/authApi";

type ApiUser = { id: string; email: string };

export default function Login() {
    const [show, setShow] = useState(false);
    const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const navigate = useNavigate();

    async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setErrorMsg(null);

        const form = e.currentTarget;
        const email = (
            form.elements.namedItem("email") as HTMLInputElement
        ).value.trim();
        const password = (
            form.elements.namedItem("password") as HTMLInputElement
        ).value;

        try {
            setStatus("loading");

            // Important: nuke any stale token before logging in again.
            // If a bad token is still around, subsequent calls in this render
            // cycle can pick it up.
            clearToken();

            // Expecting { token, user: { id, email } }
            const resp = await apiPost<{ token: string; user: ApiUser }>(
                "/auth/login",
                {
                    email,
                    password,
                }
            );

            // Always replace the token we use everywhere
            localStorage.setItem("ys_token", resp.token);
            // Clean up any legacy key you might have used in the past
            localStorage.removeItem("ysong_auth_token");

            // (Optional) sanity check: decode and log which uid we just received
            try {
                const payload = JSON.parse(atob(resp.token.split(".")[1]));
                console.log(
                    "Login payload uid:",
                    payload?.uid,
                    "email:",
                    resp.user.email
                );
            } catch {}

            // Hard redirect avoids any race with state that might still hold the old user
            window.location.replace("/app");
            // If you prefer SPA navigation, you can keep:
            // navigate("/app", { replace: true });
        } catch (err: any) {
            setStatus("error");
            const code = String(err?.message ?? "request_failed");
            const friendly =
                code === "invalid_credentials"
                    ? "Email or password is incorrect."
                    : code === "email_unverified"
                    ? "Please verify your email first. Check your inbox (and spam)."
                    : code === "unauthorized"
                    ? "Your session expired. Please try again."
                    : code === "request_failed"
                    ? "Could not reach the server. Try again shortly."
                    : code === "server_error"
                    ? "Server error. Please try again."
                    : "Something went wrong. Please try again.";
            setErrorMsg(friendly);
        } finally {
            setStatus((s) => (s === "loading" ? "idle" : s));
        }
    }

    return (
        <div className="mx-auto max-w-md px-4 sm:px-6 lg:px-8 py-10">
            <h1 className="text-3xl sm:text-4xl font-bold text-center">
                Log in
            </h1>

            <form className="mt-6 space-y-4" onSubmit={onSubmit}>
                <div>
                    <label
                        htmlFor="email"
                        className="block text-sm font-medium mb-1"
                    >
                        Email
                    </label>
                    <input
                        id="email"
                        name="email"
                        type="email"
                        autoComplete="username"
                        required
                        className="px-3 py-2 w-full rounded-lg border
              border-neutral-300 dark:border-neutral-700
              bg-white dark:bg-neutral-900
              focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                </div>

                <div>
                    <label
                        htmlFor="password"
                        className="block text-sm font-medium mb-1"
                    >
                        Password
                    </label>
                    <div className="relative">
                        <input
                            id="password"
                            name="password"
                            type={show ? "text" : "password"}
                            autoComplete="current-password"
                            required
                            className="px-3 py-2 pr-10 w-full rounded-lg border
                border-neutral-300 dark:border-neutral-700
                bg-white dark:bg-neutral-900
                focus:outline-none focus:ring-2 focus:ring-sky-500"
                        />
                        <button
                            type="button"
                            onClick={() => setShow((v) => !v)}
                            className="absolute inset-y-0 right-0 px-3 text-sm opacity-70 hover:opacity-100"
                            aria-label={
                                show ? "Hide password" : "Show password"
                            }
                        >
                            {show ? "🙈" : "👁️"}
                        </button>
                    </div>
                </div>

                <button
                    type="submit"
                    disabled={status === "loading"}
                    className="w-full px-4 py-2 text-sm font-semibold rounded-lg border
            border-neutral-300/70 dark:border-neutral-700/70
            hover:bg-neutral-50 dark:hover:bg-neutral-900
            focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-60"
                >
                    {status === "loading" ? "Signing in…" : "Continue"}
                </button>

                {status === "error" && (
                    <p className="text-sm text-rose-600" role="alert">
                        {errorMsg}
                    </p>
                )}
            </form>

            <p className="mt-4 text-center text-sm opacity-80">
                New to {import.meta.env.VITE_APP_NAME}?{" "}
                <Link className="text-sky-600 hover:underline" to="/signup">
                    Create an account
                </Link>
            </p>

            <p className="mt-4 text-center text-sm opacity-80">
                Forgot{" "}
                <Link
                    className="text-sky-600 hover:underline"
                    to="/forgot-username"
                >
                    username
                </Link>{" "}
                or{" "}
                <Link
                    className="text-sky-600 hover:underline"
                    to="/forgot-password"
                >
                    password
                </Link>
                ?
            </p>
        </div>
    );
}
