import { useState } from "react";
import { AUTH_BASE } from "../lib/authApi";

export type SocialAuthProvider = "google" | "facebook" | "apple";

type Props = {
  mode: "login" | "signup";
};

const PROVIDERS: Array<{ id: SocialAuthProvider; label: string; mark: string }> = [
  { id: "google", label: "Google", mark: "G" },
  { id: "facebook", label: "Facebook", mark: "f" },
  { id: "apple", label: "Apple", mark: "" },
];

function providerEnabled(provider: SocialAuthProvider) {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | boolean | undefined> }).env ?? {};
  const key = `VITE_OAUTH_${provider.toUpperCase()}_ENABLED`;
  return String(env[key] ?? "").toLowerCase() === "1" || String(env[key] ?? "").toLowerCase() === "true";
}

export default function SocialAuthButtons({ mode }: Props) {
  const [notice, setNotice] = useState<string | null>(null);

  const begin = (provider: SocialAuthProvider) => {
    const info = PROVIDERS.find((p) => p.id === provider)!;
    if (!providerEnabled(provider)) {
      setNotice(`${info.label} sign-in is ready in the UI, but this local build does not have provider credentials configured yet.`);
      return;
    }

    const devDevice = new URLSearchParams(window.location.search).get("devDevice");
    const returnTo = devDevice ? `/app?devDevice=${encodeURIComponent(devDevice)}` : "/app";
    const base = AUTH_BASE || window.location.origin;
    const qs = new URLSearchParams({ returnTo, mode }).toString();
    window.location.assign(`${base}/auth/oauth/${provider}/start?${qs}`);
  };

  return (
    <div className="mt-6">
      <div className="relative flex items-center gap-3 text-xs text-neutral-500 dark:text-neutral-400">
        <div className="h-px flex-1 bg-neutral-300/70 dark:bg-neutral-700" />
        <span>or continue with</span>
        <div className="h-px flex-1 bg-neutral-300/70 dark:bg-neutral-700" />
      </div>

      <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
        {PROVIDERS.map((provider) => (
          <button
            key={provider.id}
            type="button"
            onClick={() => begin(provider.id)}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-neutral-300/80 dark:border-neutral-700 bg-white/70 dark:bg-neutral-900/70 px-3 py-2 text-sm font-medium hover:bg-neutral-50 dark:hover:bg-neutral-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
            title={`Continue with ${provider.label}`}
          >
            <span className="grid h-5 w-5 place-items-center rounded-full border border-current/20 text-xs font-bold" aria-hidden>
              {provider.mark}
            </span>
            <span>{provider.label}</span>
          </button>
        ))}
      </div>

      {notice && (
        <div className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-100" role="status">
          {notice}
        </div>
      )}
    </div>
  );
}
