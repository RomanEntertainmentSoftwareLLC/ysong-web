//import { useEffect } from "react";
import "./App.css";
//import { useTheme } from "./ThemeContext";
import Home from "./components/Home";
import Footer from "./components/Footer";

function Mobile() {
    //const { dark } = useTheme();

    /*
  // Apply gradient background + text color when dark changes
  useEffect(() => {
    document.body.style.background = dark
      ? "linear-gradient(180deg, rgb(26,26,26) 0%, rgb(40,40,40) 100%)"
      : "linear-gradient(180deg, rgb(108,112,118) 0%, rgb(242,246,252) 100%)";

    document.body.style.color = dark ? "rgb(245,245,245)" : "rgb(17,17,17)";
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);
*/
    return (
        <div className="min-h-screen grid place-items-center bg-transparent">
            <main className="text-left font-sans">
                <section className="pt-24 sm:pt-10">
                    <Home />
                </section>
                <Footer />
            </main>
        </div>
    );
}

export default Mobile;
