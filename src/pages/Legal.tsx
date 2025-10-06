import { useEffect } from "react";
import { useTheme } from "../ThemeContext";

export default function Legal() {
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
      <h1 className="text-3xl sm:text-4xl font-bold">Legal Information</h1>
      <p className="mt-4 opacity-80">
        Placeholder page. Your Terms of Service, licensing, and other legal
        details will live here.
      </p>
      <ul className="mt-6 list-disc pl-6 space-y-2">
        <li>Company: Roman Entertainment Software LLC</li>
        <li>Contact: hello@ysong.ai (example)</li>
        <li>Last updated: {new Date().toLocaleDateString()}</li>
      </ul>
    </div>
  );
}
