import { useEffect, useMemo, useState } from "react";
import { apiPost } from "../lib/authApi";

type Props = {
    children: React.ReactNode;
    userAcceptedAt?: string | null;
    userAcceptedVersion?: string | null;
    currentVersion?: string | null;
    /** pass the signed-in user's id; leave undefined while loading, null if not signed in */
    userId?: string | null;
    /** optional hook for parent to refetch /auth/me after accept */
    onAccepted?: () => void;
};

export default function TosGate({
    children,
    userAcceptedAt,
    userAcceptedVersion,
    currentVersion,
    userId,
    onAccepted,
}: Props) {
    const [mustAccept, setMustAccept] = useState(false);
    const [ready, setReady] = useState(false);

    // Namespaced per TOS version and per user (or "anon" when no user)
    const KEY = useMemo(() => {
        const ver = currentVersion || "v0";
        const uid = userId || "anon";
        return `ysong.tos.accepted.${ver}.${uid}`;
    }, [currentVersion, userId]);

    // Decide whether to show the TOS modal.
    useEffect(() => {
        // While loading user (userId === undefined), don't decide yet.
        if (typeof userId === "undefined") {
            setReady(false);
            return;
        }

        // If signed in, server is the source of truth — ignore local flag.
        if (userId) {
            const acceptedByServer =
                !!userAcceptedAt &&
                !!userAcceptedVersion &&
                userAcceptedVersion === currentVersion;

            setMustAccept(!acceptedByServer);
            setReady(true);
            return;
        }

        // Anonymous session: use the scoped localStorage key.
        const acceptedLocal = localStorage.getItem(KEY) === "1";
        setMustAccept(!acceptedLocal);
        setReady(true);
    }, [userId, userAcceptedAt, userAcceptedVersion, currentVersion, KEY]);

    if (!ready) return <>{children}</>;

    async function onAccept() {
        try {
            // If signed in, persist to server.
            if (userId) {
                await apiPost("/auth/accept-tos", {});
            }
        } catch {
            // Network hiccups are tolerated; local key still gates the UI.
        }

        // Persist local hint for the current scope (version + user/anon)
        localStorage.setItem(KEY, "1");

        // Clean up any legacy anon keys so they can't mask future users.
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i) || "";
                if (
                    k.startsWith("ysong.tos.accepted.") &&
                    k.endsWith(".anon")
                ) {
                    localStorage.removeItem(k);
                    // adjust index since storage shrank
                    i = Math.max(-1, i - 1);
                }
            }
        } catch {
            /* ignore */
        }

        setMustAccept(false);
        onAccepted?.();
    }

    function onDecline() {
        // Block app usage until they accept
        window.location.href = "/";
    }

    return (
        <>
            {children}
            {mustAccept && (
                <div
                    role="dialog"
                    aria-modal
                    className="fixed inset-0 z-[1000] grid place-items-center bg-black/60 p-4"
                >
                    <div className="w-full max-w-2xl rounded-2xl bg-neutral-900 p-6">
                        <h2 className="text-xl font-bold">Terms of Service</h2>
                        <p className="mt-2 text-sm opacity-80">
                            Please review and accept the latest Terms to
                            continue using YSong.
                            <a
                                className="underline ml-1"
                                href="/terms-of-service"
                                target="_blank"
                                rel="noreferrer"
                            >
                                Read full Terms
                            </a>
                        </p>

                        <div className="mt-4 h-48 overflow-y-auto rounded-lg bg-neutral-800/60 p-3 text-sm">
                            <ul className="list-disc pl-5 space-y-2">
                                <li>
                                    Music-only use; no illegal/infringing
                                    content.
                                </li>
                                <li>
                                    Some styles/voices require licenses; we may
                                    block unlicensed generation.
                                </li>
                                <li>
                                    Service is provided “as is”; liability is
                                    limited.
                                </li>
                            </ul>
                        </div>

                        <div className="mt-6 flex justify-end gap-3">
                            <button
                                onClick={onDecline}
                                className="rounded-xl px-4 py-2 bg-neutral-800"
                            >
                                Decline
                            </button>
                            <button
                                onClick={onAccept}
                                className="rounded-xl px-4 py-2 bg-white text-black font-semibold"
                            >
                                I Accept
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
