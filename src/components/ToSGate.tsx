// src/components/TosGate.tsx
import { useEffect, useState } from "react";

type Props = {
    children: React.ReactNode;
    userAcceptedAt?: string | null;
    userAcceptedVersion?: string | null;
    currentVersion?: string | null; // provided by API (/auth/me or /auth/login)
};

function getToken() {
    return (
        localStorage.getItem("ysong.token") ||
        localStorage.getItem("token") ||
        ""
    );
}

export default function TosGate({
    children,
    userAcceptedAt,
    userAcceptedVersion,
    currentVersion,
}: Props) {
    const [ready, setReady] = useState(false);
    const [mustAccept, setMustAccept] = useState(false);

    useEffect(() => {
        // If server didn’t tell us the current version yet, don’t block.
        if (!currentVersion) {
            setMustAccept(false);
            setReady(true);
            return;
        }

        // Legacy localStorage accept (from earlier client-only versioning)
        const legacyKey = `ysong.tos.accepted.${currentVersion}`;
        const legacyAccepted = localStorage.getItem(legacyKey) === "1";

        const serverThinksAccepted =
            !!userAcceptedAt && userAcceptedVersion === currentVersion;

        const need = !(serverThinksAccepted || legacyAccepted);
        setMustAccept(need);
        setReady(true);
    }, [userAcceptedAt, userAcceptedVersion, currentVersion]);

    if (!ready) return <>{children}</>;

    async function onAccept() {
        try {
            const token = getToken();
            if (token) {
                await fetch("/auth/accept-tos", {
                    method: "POST",
                    headers: { Authorization: `Bearer ${token}` },
                });
            }
        } catch {
            // even if the call fails, fall back to client accept so user isn’t stuck
        }

        if (currentVersion) {
            localStorage.setItem(`ysong.tos.accepted.${currentVersion}`, "1");
        }
        setMustAccept(false);
    }

    if (!mustAccept) return <>{children}</>;

    return (
        <>
            {children}
            <div
                role="dialog"
                aria-modal
                className="fixed inset-0 z-[1000] grid place-items-center bg-black/60 p-4"
            >
                <div className="w-full max-w-2xl rounded-2xl bg-neutral-900 p-6">
                    <h2 className="text-xl font-bold">Terms of Service</h2>
                    <p className="mt-2 text-sm opacity-80">
                        Please review and accept the latest Terms to continue
                        using YSong.
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
                                Music-only use; no illegal/infringing content.
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
                            onClick={() => (window.location.href = "/")}
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
        </>
    );
}
