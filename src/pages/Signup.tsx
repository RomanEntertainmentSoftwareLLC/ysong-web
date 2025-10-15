import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";

export default function Signup() {
    const [show, setShow] = useState(false);
    const [matchErr, setMatchErr] = useState("");
    const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">(
        "idle"
    );
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    // axe-friendly ARIA for confirm field
    const confirmRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const el = confirmRef.current;
        if (!el) return;
        el.setAttribute("aria-invalid", matchErr ? "true" : "false");
        if (matchErr) el.setAttribute("aria-errormessage", "confirm-error");
        else el.removeAttribute("aria-errormessage");
    }, [matchErr]);

    const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setErrorMsg(null);

        const form = e.currentTarget;
        const name =
            (
                form.elements.namedItem("name") as HTMLInputElement
            )?.value?.trim() || "";
        const email =
            (
                form.elements.namedItem("email") as HTMLInputElement
            )?.value?.trim() || "";
        const pw =
            (form.elements.namedItem("password") as HTMLInputElement)?.value ||
            "";
        const pw2 =
            (form.elements.namedItem("confirm") as HTMLInputElement)?.value ||
            "";

        if (pw !== pw2) {
            setMatchErr("Passwords don’t match.");
            return;
        }
        setMatchErr("");

        try {
            setStatus("loading");
            await api.signup(email, pw, name || undefined);
            setStatus("done"); // show “check your email” UI
            form.reset();
        } catch (err: any) {
            setStatus("error");
            setErrorMsg(
                err?.message || "Something went wrong. Please try again."
            );
        }
    };

    return (
        <div className="mx-auto max-w-md px-4 sm:px-6 lg:px-8 py-10">
            <h1 className="text-3xl sm:text-4xl font-bold text-center">
                Create account
            </h1>

            <form className="mt-6 space-y-4" onSubmit={onSubmit}>
                <div>
                    <label
                        htmlFor="name"
                        className="block text-sm font-medium mb-1"
                    >
                        Name
                    </label>
                    <input
                        id="name"
                        name="name"
                        type="text"
                        autoComplete="name"
                        required
                        className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700
                       bg-white dark:bg-neutral-900 px-3 py-2
                       focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                </div>

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
                        autoComplete="email"
                        required
                        className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700
                       bg-white dark:bg-neutral-900 px-3 py-2
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
                            autoComplete="new-password"
                            required
                            minLength={8}
                            className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700
                         bg-white dark:bg-neutral-900 px-3 py-2 pr-10
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
                    <p className="mt-1 text-xs opacity-70">
                        Use 8+ characters.
                    </p>
                </div>

                <div>
                    <label
                        htmlFor="confirm"
                        className="block text-sm font-medium mb-1"
                    >
                        Confirm password
                    </label>
                    <input
                        id="confirm"
                        name="confirm"
                        ref={confirmRef}
                        type={show ? "text" : "password"}
                        autoComplete="new-password"
                        required
                        aria-invalid="false" // literal; updated via useEffect
                        className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700
                       bg-white dark:bg-neutral-900 px-3 py-2
                       focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                    {matchErr && (
                        <p
                            id="confirm-error"
                            role="alert"
                            className="mt-1 text-sm text-rose-600"
                        >
                            {matchErr}
                        </p>
                    )}
                </div>

                <button
                    type="submit"
                    disabled={status === "loading"}
                    className="w-full px-4 py-2 text-sm font-semibold rounded-lg border
             border-neutral-300/70 dark:border-neutral-700/70
             hover:bg-neutral-50 dark:hover:bg-neutral-900
             focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-60"
                >
                    {status === "loading" ? "Creating…" : "Create account"}
                </button>

                {status === "done" && (
                    <div
                        className="mt-2 rounded-md border border-emerald-500/30 bg-emerald-50 dark:bg-emerald-900/20 p-3 text-sm"
                        role="status"
                    >
                        <p className="font-medium">Check your email</p>
                        <p>
                            We sent a verification link. It expires in ~30
                            minutes.
                        </p>
                    </div>
                )}

                {status === "error" && (
                    <p className="mt-2 text-sm text-rose-600" role="alert">
                        {errorMsg}
                    </p>
                )}

                <p className="mt-3 text-xs opacity-80">
                    By creating an account, you agree to our{" "}
                    <Link to="/legal" className="text-sky-600 hover:underline">
                        Legal Information
                    </Link>{" "}
                    and{" "}
                    <Link
                        to="/privacy"
                        className="text-sky-600 hover:underline"
                    >
                        Privacy Notice
                    </Link>
                    .
                </p>
            </form>

            <p className="mt-4 text-center text-sm opacity-80">
                Already have an account?{" "}
                <Link to="/login" className="text-sky-600 hover:underline">
                    Log in
                </Link>
            </p>
        </div>
    );
}
