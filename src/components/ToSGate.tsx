import { useEffect, useMemo, useState } from "react";
import { apiPost } from "../lib/authApi";

type Props = {
    children: React.ReactNode;
    userAcceptedAt?: string | null;
    userAcceptedVersion?: string | null;
    currentVersion?: string | null;
    userId?: string | null; // <- pass current user id so the local flag is per user
    onAccepted?: () => void; // optional: e.g. refetch /auth/me after accept
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

    // Key is namespaced by version AND userId so different users don’t block each other
    const KEY = useMemo(() => {
        const ver = currentVersion || "v0";
        const uid = userId || "anon";
        return `ysong.tos.accepted.${ver}.${uid}`;
    }, [currentVersion, userId]);

    useEffect(() => {
        // 1) Server says accepted (timestamp exists) AND version matches → we’re good
        const acceptedByServer =
            !!userAcceptedAt &&
            !!userAcceptedVersion &&
            userAcceptedVersion === currentVersion;

        // 2) If not confirmed by server yet, we allow a local fast-path
        const acceptedLocal = localStorage.getItem(KEY) === "1";

        setMustAccept(!(acceptedByServer || acceptedLocal));
        setReady(true);
    }, [KEY, userAcceptedAt, userAcceptedVersion, currentVersion]);

    if (!ready) return <>{children}</>;

    async function onAccept() {
        try {
            // Persist on server (includes auth token automatically via apiPost)
            await apiPost("/auth/accept-tos", {});
        } catch {
            // even if the network hiccups, still set local so the user can proceed;
            // server will be updated next time we can reach it
        }
        localStorage.setItem(KEY, "1");
        setMustAccept(false);

        // Optional: let the parent refetch /auth/me so UI shows fresh values
        onAccepted?.();
    }

    function onDecline() {
        // Kick them out of the app area until they accept
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
