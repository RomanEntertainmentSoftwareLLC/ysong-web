import { useEffect } from "react";
import { useTheme } from "../ThemeContext";

export default function Privacy() {
  const { dark } = useTheme();

  useEffect(() => {
    document.body.style.background = dark
      ? "linear-gradient(180deg, rgb(26,26,26) 0%, rgb(40,40,40) 100%)"
      : "linear-gradient(180deg, rgb(108,112,118) 0%, rgb(242,246,252) 100%)";

    document.body.style.color = dark ? "rgb(245,245,245)" : "rgb(17,17,17)";
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-10">
      <h1 className="text-3xl sm:text-4xl font-bold">Privacy Notice</h1>
      <p className="mt-4 opacity-80">
        Placeholder page. Your data collection, usage, and retention policy will
        go here.
      </p>
      <ul className="mt-6 list-disc pl-6 space-y-2">
        <li>We’ll add the exact policy text later.</li>
        <li>Include contact and request procedures.</li>
      </ul>
    </div>
  );
}
