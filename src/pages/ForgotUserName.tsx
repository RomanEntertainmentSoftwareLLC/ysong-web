import { Link } from "react-router-dom";

export default function ForgotUserName() {
    return (
        <div className="mx-auto max-w-md px-4 sm:px-6 lg:px-8 py-10">
            <h1 className="text-3xl sm:text-4xl font-bold text-center">
                Forgot Username?
            </h1>
            <p className="mt-3 text-center opacity-80">
                Enter your email and we'll send instructions to recover your
                username.
            </p>
            <section className="mt-8 space-y-4">
                <h2 className="text-lg font-semibold">Reset password</h2>
                <div>
                    <label
                        htmlFor="pw-email"
                        className="block text-sm font-medium mb-1"
                    >
                        Email
                    </label>
                    <input
                        id="pw-email"
                        type="email"
                        placeholder="you@example.com"
                        className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700
									text-white bg-white dark:bg-neutral-900 px-3 py-2
									focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                </div>
                <button
                    type="button"
                    className="w-full px-4 py-2 text-sm font-semibold rounded-lg border"
                >
                    Email me a reset link
                </button>
            </section>
            <p className="mt-6 text-center text-sm">
                <Link
                    to="/login"
                    className="text-indigo-400 hover:text-indigo-300"
                >
                    Back to login
                </Link>
            </p>
        </div>
    );
}
