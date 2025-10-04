import { useState } from "react";
import reactLogo from "./assets/react.svg";
import ysongLogo from "/ysong-icon.ico";
import ysongTitleWithLogo from "/ysong-logo-with-title-darkmode.png";
import "./App.css";

function App() {
  const [count, setCount] = useState(0);

  return (
    <div className="min-h-screen grid place-items-center bg-neutral-900 text-neutral-100">
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
                h-20 w-20 sm:h-24 sm:w-24
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
                h-20 w-20 sm:h-24 sm:w-24
                transition-[filter,transform] duration-300
                hover:drop-shadow-[0_0_20px_#61dafb88]
                hover:scale-105
                motion-safe:animate-[spin_20s_linear_infinite]
              "
            />
          </a>
        </div>

        <h1 className="text-5xl sm:text-6xl font-extrabold tracking-tight">
          Welcome to{" "}
          <img
            src={ysongTitleWithLogo}
            alt="Title"
            className="h-20 w-auto inline-block align-middle transition-transform hover:scale-110"
          />{" "}
          🎶
        </h1>

        <p className="mt-3 text-sm text-neutral-300">
          Powered by <span className="font-medium">Vite</span> +{" "}
          <span className="font-medium">React</span> +{" "}
          <span className="font-medium">TypeScript</span> +{" "}
          <span className="font-medium">Vercel</span> +{" "}
          <span className="font-medium">Tailwind CSS</span>🚀
        </p>

        <button
          onClick={() => setCount((count) => count + 1)}
          className="mt-6 rounded-lg border border-transparent px-5 py-2.5 text-base font-medium bg-neutral-800 hover:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          count is {count}
        </button>

        <p className="mt-6 text-neutral-400">
          Edit <code className="font-mono">src/App.tsx</code> and save to test
          HMR
        </p>
      </main>
    </div>
  );
  /*
  return (
    <>
      <div>
        <a href="https://vite.dev" target="_blank" rel="noopener noreferrer">
          <img src={ysongLogo} className="logo" alt="Vite logo" />
        </a>
        <a href="https://react.dev" target="_blank" rel="noopener noreferrer">
          <img src={reactLogo} className="logo react" alt="React logo" />
        </a>
      </div>
      <h1>Welcome to YSong.ai 🎶</h1>
      <p>Powered by Vite + React + Vercel 🚀</p>
      <div className="card">
        <button onClick={() => setCount((count) => count + 1)}>
          count is {count}
        </button>
        <p>
          Edit <code>src/App.tsx</code> and save to test HMR
        </p>
      </div>
      <p className="read-the-docs">
        Click on the Vite and React logos to learn more
      </p>
    </>
  );
  */
}

export default App;
