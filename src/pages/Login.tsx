import { useState } from "react";
import { Link } from "react-router-dom";
import { apiPost, clearToken } from "../lib/authApi";
import { YSButton } from "../components/YSButton";
import SocialAuthButtons from "../components/SocialAuthButtons";

type ApiUser = { id: string; email: string };

export default function Login() {
	const [show, setShow] = useState(false);
	const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
	const [errorMsg, setErrorMsg] = useState<string | null>(null);

	// Always render the login form. Saved passwords belong to the browser/OS
	// credential manager; a prior YSong token must never bypass this screen.

	async function offerCredentialToBrowser(email: string, password: string) {
		// Never store a password ourselves. When supported (Chrome/Chromium), hand
		// the successful credential to the browser's password manager instead.
		// The browser remains in control of whether it saves/prompts/autofills it.
		try {
			const nav = navigator as Navigator & {
				credentials?: { store?: (credential: unknown) => Promise<unknown> };
			};
			const PasswordCredentialCtor = (window as unknown as {
				PasswordCredential?: new (data: { id: string; password: string; name?: string }) => unknown;
			}).PasswordCredential;
			if (!nav.credentials?.store || !PasswordCredentialCtor) return;
			await nav.credentials.store(new PasswordCredentialCtor({ id: email, password, name: email }));
		} catch {
			// Password-manager support/permissions vary by browser. Login must never
			// fail just because the browser declines to store a credential.
		}
	}

	function codeFromError(error: unknown) {
		return error instanceof Error ? error.message : "request_failed";
	}

	async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		setErrorMsg(null);

		const form = e.currentTarget;
		const email = (form.elements.namedItem("email") as HTMLInputElement).value.trim();
		const password = (form.elements.namedItem("password") as HTMLInputElement).value;

		try {
			setStatus("loading");

			// Important: nuke any stale token before logging in again.
			// If a bad token is still around, subsequent calls in this render
			// cycle can pick it up.
			clearToken();

			// A local dev startup can briefly race the API/DB connection. Retry one
			// transient server/network failure automatically instead of making the
			// user press Enter a second time. Never retry credential/verification errors.
			const doLogin = () => apiPost<{ token: string; user: ApiUser }>("/auth/login", { email, password });
			let resp: { token: string; user: ApiUser };
			try {
				resp = await doLogin();
			} catch (firstErr: unknown) {
				const code = codeFromError(firstErr);
				if (code !== "server_error" && code !== "request_failed") throw firstErr;
				await new Promise((resolve) => window.setTimeout(resolve, 300));
				resp = await doLogin();
			}

			// Replace the in-app auth token after a successful explicit login.
			// Password persistence is handled only by the browser/OS password manager.
			localStorage.setItem("ys_token", resp.token);
			// Clean up any legacy key you might have used in the past
			localStorage.removeItem("ysong_auth_token");

			// (Optional) sanity check: decode and log which uid we just received
			try {
				const payload = JSON.parse(atob(resp.token.split(".")[1]));
				console.log("Login payload uid:", payload?.uid, "email:", resp.user.email);
			} catch {
				// Debug-only token decoding; malformed tokens are handled by /auth/me.
			}

			// Give the browser password manager the successful credential. We never
			// persist the raw password ourselves.
			await offerCredentialToBrowser(email, password);

			// Hard redirect avoids any race with state that might still hold the old user
			const devDevice = new URLSearchParams(window.location.search).get("devDevice");
			window.location.replace(devDevice ? `/app?devDevice=${encodeURIComponent(devDevice)}` : "/app");
			// If you prefer SPA navigation, you can keep:
			// navigate("/app", { replace: true });
		} catch (err: unknown) {
			setStatus("error");
			const code = codeFromError(err);
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
			<h1 className="text-3xl sm:text-4xl font-bold text-center">Log in</h1>

			<form className="mt-6 space-y-4" onSubmit={onSubmit} method="post" autoComplete="on">
				<div>
					<label htmlFor="email" className="block text-sm font-medium mb-1">
						Email
					</label>
					<input
						id="email"
						name="email"
						type="email"
						autoComplete="username"
						autoCapitalize="none"
						spellCheck={false}
						required
						className="px-3 py-2 w-full rounded-lg border
              border-neutral-300 dark:border-neutral-700
              bg-white dark:bg-neutral-900
              focus:outline-none focus:ring-2 focus:ring-sky-500"
					/>
				</div>

				<div>
					<label htmlFor="password" className="block text-sm font-medium mb-1">
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
						<YSButton
							type="button"
							onClick={() => setShow((v) => !v)}
							className="absolute inset-y-0 right-0 px-3 text-sm opacity-70 hover:opacity-100"
							aria-label={show ? "Hide password" : "Show password"}
						>
							{show ? "🙈" : "👁️"}
						</YSButton>
					</div>
				</div>

				<YSButton
					type="submit"
					disabled={status === "loading"}
					className="w-full px-4 py-2 text-sm font-semibold rounded-lg border
            border-neutral-300/70 dark:border-neutral-700/70
            hover:bg-neutral-50 dark:hover:bg-neutral-900
            focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-60"
				>
					{status === "loading" ? "Signing in…" : "Continue"}
				</YSButton>

				{status === "error" && (
					<p className="text-sm text-rose-600" role="alert">
						{errorMsg}
					</p>
				)}
			</form>

			<SocialAuthButtons mode="login" />

			<p className="mt-4 text-center text-sm opacity-80">
				New to {import.meta.env.VITE_APP_NAME}?{" "}
				<Link className="text-sky-600 hover:underline" to="/signup">
					Create an account
				</Link>
			</p>

			<p className="mt-4 text-center text-sm opacity-80">
				Forgot{" "}
				<Link className="text-sky-600 hover:underline" to="/forgot-username">
					username
				</Link>{" "}
				or{" "}
				<Link className="text-sky-600 hover:underline" to="/forgot-password">
					password
				</Link>
				?
			</p>
		</div>
	);
}
