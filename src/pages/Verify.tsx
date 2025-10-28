import { useEffect, useState } from "react";
import { apiGet } from "../lib/authApi";

export default function VerifyPage() {
    const [state, setState] = useState<"loading" | "ok" | "fail">("loading");
    const [reason, setReason] = useState<string | null>(null);

    useEffect(() => {
        const url = new URL(window.location.href);
        const token = url.searchParams.get("token");
        const email = url.searchParams.get("email");

        if (!token || !email) {
            setState("fail");
            setReason("missing_params");
            return;
        }

        apiGet(
            `/auth/verify?token=${encodeURIComponent(
                token
            )}&email=${encodeURIComponent(email)}`
        )
            .then(() => setState("ok"))
            .catch((e: any) => {
                setState("fail");
                setReason(e?.message ?? "request_failed");
            });
    }, []);

    return (
        <div className="mx-auto max-w-md px-4 sm:px-6 lg:px-8 py-10">
            <h1 className="text-3xl sm:text-4xl font-bold text-center">
                Verify email
            </h1>

            {state === "loading" && (
                <p className="mt-6 text-center">Verifying…</p>
            )}

            {state === "ok" && (
                <div className="mt-6 rounded-md border border-emerald-500/30 bg-emerald-50 dark:bg-emerald-900/20 p-4">
                    <p className="font-medium">All set!</p>
                    <p>Your email is verified. You can now log in.</p>
                </div>
            )}

            {state === "fail" && (
                <div className="mt-6 rounded-md border border-rose-500/30 bg-rose-50 dark:bg-rose-900/10 p-4">
                    <p className="font-medium">Link invalid or expired.</p>
                    <p className="opacity-80">
                        {reason
                            ? `Reason: ${reason}`
                            : "Please request a new verification email."}
                    </p>
                </div>
            )}
        </div>
    );
}
