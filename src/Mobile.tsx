import { useState, useEffect } from "react";
import reactLogo from "./assets/react.svg";
import ysongLogo from "/ysong-icon.ico";
import ysongTitleWithLogo from "/ysong-logo-with-title.png";
import ysongTitleWithLogoDark from "/ysong-logo-with-title-darkmode.png";
import "./App.css";

function Mobile() {
  //const [count, setCount] = useState(0);

  const [dark, setDark] = useState(true);

  // apply the theme to <html>
  useEffect(() => {
    // apply colors you chose
    document.body.style.background = dark
      ? "linear-gradient(180deg, rgb(26,26,26) 0%, rgb(40,40,40) 100%)"
      : "linear-gradient(180deg, rgb(108,112,118) 0%, rgb(242,246,252) 100%)";
    document.body.style.color = dark ? "rgb(245,245,245)" : "rgb(17,17,17)";
    // optional: let the browser know which scheme is active (scrollbars, form controls)
    document.documentElement.style.colorScheme = dark ? "dark" : "light";

    // (optional) remember choice
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

  return (
    <div className="min-h-screen grid place-items-center bg-transparent">
      <main className="text-center font-sans">
        {/* ICON ROW */}
        <div className="flex items-center justify-center gap-12 mb-10">
          <a
            href="https://vite.dev"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="YSong"
            className="transition-transform hover:scale-105"
          >
            <img
              src={ysongLogo}
              alt="YSong"
              className="
                h-12 w-12 sm:h-20 sm:w-20
                transition-[filter,transform] duration-300
                hover:drop-shadow-[0_0_20px_#646cff88]
                hover:scale-105
              "
            />
          </a>

          <a
            href="https://react.dev"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="React"
            className="transition-transform hover:scale-105"
          >
            <img
              src={reactLogo}
              alt="React"
              className="
                h-12 w-12 sm:h-20 sm:w-20
                transition-[filter,transform] duration-300
                hover:drop-shadow-[0_0_20px_#61dafb88]
                hover:scale-105
                motion-safe:animate-[spin_20s_linear_infinite]
              "
            />
          </a>
        </div>

        <h1>
          Mobile{" "}
          <img
            src={dark ? ysongTitleWithLogoDark : ysongTitleWithLogo}
            alt="Title"
            className="h-10 w-auto sm:h-20 inline-block align-middle transition-transform hover:scale-110"
          />{" "}
          🎶
        </h1>

        <p className="mt-3 text-xs">
          Powered by <span className="font-medium">Vite</span> +{" "}
          <span className="font-medium">React</span> +{" "}
          <span className="font-medium">TypeScript</span> +{" "}
          <span className="font-medium">Vercel</span> +{" "}
          <span className="font-medium">Tailwind CSS</span>🚀
        </p>

        <button
          onClick={() => setDark(!dark)}
          className="mt-6 rounded-lg border border-transparent
            px-3 py-1.5 text-sm sm:text-base font-medium 
          bg-[rgb(155,155,155)] hover:bg-[rgb(185,185,185)]
          hover:border-indigo-400 focus:outline-none focus:ring-2
          focus:ring-indigo-500 transition"
        >
          {dark ? "☀️ Light mode" : "🌙 Dark mode"}
        </button>

        {/*<button
          onClick={() => setCount((count) => count + 1)}
          className="mt-6 rounded-lg border border-transparent px-3 py-1.5 text-sm font-medium bg-neutral-800 hover:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          count is {count}
        </button>*/}
      </main>
    </div>
  );
}

export default Mobile;
