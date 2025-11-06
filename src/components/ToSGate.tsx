import { useEffect, useState } from "react";

const TOS_VERSION = "2025-11-05-v1";
const KEY = `ysong.tos.accepted.${TOS_VERSION}`;

export default function TosGate({ children }: { children: React.ReactNode }) {
    const [ready, setReady] = useState(false);
    const [mustAccept, setMustAccept] = useState(false);

    useEffect(() => {
        const accepted = localStorage.getItem(KEY) === "1";
        setMustAccept(!accepted);
        setReady(true);
    }, []);

    if (!ready) return null;

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
                                onClick={() => {
                                    window.location.href = "/";
                                }}
                                className="rounded-xl px-4 py-2 bg-neutral-800"
                            >
                                Decline
                            </button>
                            <button
                                onClick={() => {
                                    localStorage.setItem(KEY, "1");
                                    setMustAccept(false);
                                }}
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
