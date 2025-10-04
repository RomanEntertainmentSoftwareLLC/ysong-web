import { useEffect, useState } from "react";
import Mobile from "./Mobile";
import Desktop from "./Desktop";
import "./App.css";

function useMediaQuery(query: string) {
  const get = () =>
    typeof window !== "undefined" && window.matchMedia(query).matches;
  const [matches, setMatches] = useState<boolean>(get());

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    setMatches(mql.matches);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

function App() {
  const isMobile = useMediaQuery("(max-width: 640px)");

  return <div>{isMobile ? <Mobile /> : <Desktop />}</div>;
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
