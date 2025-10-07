import { useState } from "react";
import { Link } from "react-router-dom";

export default function Login() {
  const [show, setShow] = useState(false);

  return (
    <div className="mx-auto max-w-md px-4 sm:px-6 lg:px-8 py-10">
      <h1 className="text-3xl sm:text-4xl font-bold text-center">Log in</h1>

      <form
        className="mt-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          // TODO: plug in auth
        }}
      >
        <div>
          <label htmlFor="email" className="block text-sm font-medium mb-1">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            className="px-3 py-2 w-full rounded-lg border"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium mb-1">
            Password
          </label>
          <div className="relative">
            <input
              id="password"
              type={show ? "text" : "password"}
              required
              className="px-3 py-2 pr-10 w-full rounded-lg border"
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              className="absolute inset-y-0 right-0 px-3 text-sm opacity-70 hover:opacity-100"
              aria-label={show ? "Hide password" : "Show password"}
            >
              {show ? "🙈" : "👁️"}
            </button>
          </div>
        </div>

        {/* Submit */}
        <button
          type="submit"
          className="w-full px-4 py-2 text-sm font-semibold rounded-lg border
             border-neutral-300/70 dark:border-neutral-700/70
             hover:bg-neutral-50 dark:hover:bg-neutral-900
             focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
        >
          Continue
        </button>
      </form>

      <p className="mt-4 text-center text-sm opacity-80">
        New to YSong? <Link to="/signup">Create an account</Link>
      </p>

      {/* NEW: forgot link */}
      <p className="mt-4 text-center text-sm opacity-80">
        <Link to="/forgot">Forgot username or password?</Link>
      </p>
    </div>
  );
}
