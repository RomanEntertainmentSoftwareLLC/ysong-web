import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useTheme } from "../ThemeContext";

export default function Login() {
  const { dark } = useTheme();
  const [show, setShow] = useState(false);

  useEffect(() => {
    document.body.style.background = dark
      ? "linear-gradient(180deg, rgb(26,26,26) 0%, rgb(40,40,40) 100%)"
      : "linear-gradient(180deg, rgb(108,112,118) 0%, rgb(242,246,252) 100%)";

    document.body.style.color = dark ? "rgb(245,245,245)" : "rgb(17,17,17)";
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

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
            className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700
                       text-white bg-white dark:bg-neutral-900 px-3 py-2
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
              type={show ? "text" : "password"}
              required
              className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700
                         text-white bg-white dark:bg-neutral-900 px-3 py-2 pr-10
                         focus:outline-none focus:ring-2 focus:ring-sky-500"
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

        {/*Submit Button*/}
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
        New to YSong?{" "}
        <Link to="/signup" className="text-sky-600 hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
