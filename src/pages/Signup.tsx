import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { apiPost } from "../lib/authApi";
import { YSButton } from "../components/YSButton";
import SocialAuthButtons from "../components/SocialAuthButtons";

export default function Signup() {
	const [show, setShow] = useState(false);
	const [matchErr, setMatchErr] = useState("");
	const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
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
		const name = (form.elements.namedItem("name") as HTMLInputElement)?.value?.trim() || "";
		const email = (form.elements.namedItem("email") as HTMLInputElement)?.value?.trim() || "";
		const gender = (form.elements.namedItem("gender") as HTMLSelectElement)?.value || "prefer_not_to_say";
		const country = (form.elements.namedItem("country") as HTMLInputElement)?.value?.trim() || "";
		const region = (form.elements.namedItem("region") as HTMLInputElement)?.value?.trim() || "";
		const city = (form.elements.namedItem("city") as HTMLInputElement)?.value?.trim() || "";
		const pw = (form.elements.namedItem("password") as HTMLInputElement)?.value || "";
		const pw2 = (form.elements.namedItem("confirm") as HTMLInputElement)?.value || "";

		if (pw !== pw2) {
			setMatchErr("Passwords don’t match.");
			return;
		}
		setMatchErr("");

		try {
			setStatus("loading");
			const result = await apiPost<{ local?: boolean; message?: string }>("/auth/signup", {
				email,
				password: pw,
				name: name || undefined,
				gender, country, region, city,
			});
			try { sessionStorage.setItem("ysong:lastSignupWasLocal", result?.local ? "1" : "0"); } catch {}
			setStatus("done");
			form.reset();
		} catch (err: any) {
			setStatus("error");
			const msg =
				err?.message === "account_exists"
					? "An account with that email already exists. Try logging in."
					: err?.message === "username_taken"
					? "That username / display name is already in use."
					: err?.message || "Something went wrong. Please try again.";
			setErrorMsg(msg);
		}
	};

	return (
		<div className="mx-auto max-w-md px-4 sm:px-6 lg:px-8 py-10">
			<h1 className="text-3xl sm:text-4xl font-bold text-center">Create account</h1>

			<form className="mt-6 space-y-4" onSubmit={onSubmit}>
				<div>
					<label htmlFor="name" className="block text-sm font-medium mb-1">
						Username / display name
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
					<p className="mt-1 text-xs opacity-70">This is the name other YSong users can see. Your email stays private.</p>
				</div>

				<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
					<div>
						<label htmlFor="gender" className="block text-sm font-medium mb-1">Gender</label>
						<select id="gender" name="gender" required defaultValue="prefer_not_to_say" className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500">
							<option value="female">Female</option><option value="male">Male</option><option value="nonbinary">Non-binary</option><option value="other">Other</option><option value="prefer_not_to_say">Prefer not to say</option>
						</select>
					</div>
					<div><label htmlFor="country" className="block text-sm font-medium mb-1">Country</label><input id="country" name="country" type="text" required autoComplete="country-name" className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500" /></div>
				</div>
				<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
					<div><label htmlFor="region" className="block text-sm font-medium mb-1">State / region</label><input id="region" name="region" type="text" autoComplete="address-level1" className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500" /></div>
					<div><label htmlFor="city" className="block text-sm font-medium mb-1">City</label><input id="city" name="city" type="text" autoComplete="address-level2" className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500" /></div>
				</div>
				<p className="text-xs opacity-70 -mt-1">Location and gender are used for aggregated creator analytics. Individual profile details are not exposed in analytics.</p>

				<div>
					<label htmlFor="email" className="block text-sm font-medium mb-1">
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
					<label htmlFor="password" className="block text-sm font-medium mb-1">
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
						<YSButton
							type="button"
							onClick={() => setShow((v) => !v)}
							className="absolute inset-y-0 right-0 px-3 text-sm opacity-70 hover:opacity-100"
							aria-label={show ? "Hide password" : "Show password"}
						>
							{show ? "🙈" : "👁️"}
						</YSButton>
					</div>
					<p className="mt-1 text-xs opacity-70">Use 8+ characters.</p>
				</div>

				<div>
					<label htmlFor="confirm" className="block text-sm font-medium mb-1">
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
						<p id="confirm-error" role="alert" className="mt-1 text-sm text-rose-600">
							{matchErr}
						</p>
					)}
				</div>

				<YSButton
					type="submit"
					disabled={status === "loading"}
					className="w-full px-4 py-2 text-sm font-semibold rounded-lg border
             border-neutral-300/70 dark:border-neutral-700/70
             hover:bg-neutral-50 dark:hover:bg-neutral-900
             focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-60"
				>
					{status === "loading" ? "Creating…" : "Create account"}
				</YSButton>

				{status === "done" && (
					<div
						className="mt-2 rounded-md border border-emerald-500/30 bg-emerald-50 dark:bg-emerald-900/20 p-3 text-sm"
						role="status"
					>
						{(() => {
							let local = false;
							try { local = sessionStorage.getItem("ysong:lastSignupWasLocal") === "1"; } catch {}
							return local ? (
								<>
									<p className="font-medium">Local account created</p>
									<p>No email verification is needed. You can log in now.</p>
								</>
							) : (
								<>
									<p className="font-medium">Check your email</p>
									<p>We sent a verification link. It expires in ~30 minutes.</p>
								</>
							);
						})()}
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
					<Link to="/privacy" className="text-sky-600 hover:underline">
						Privacy Notice
					</Link>
					.
				</p>
			</form>

			<SocialAuthButtons mode="signup" />

			<p className="mt-4 text-center text-sm opacity-80">
				Already have an account?{" "}
				<Link to="/login" className="text-sky-600 hover:underline">
					Log in
				</Link>
			</p>
		</div>
	);
}
