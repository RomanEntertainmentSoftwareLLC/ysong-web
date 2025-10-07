import { useEffect } from "react";
import { useTheme } from "../ThemeContext";

/** Applies the site background gradient + colorScheme. */
export default function UseGradientBackground() {
  const { dark } = useTheme();

  useEffect(() => {
    const bg = dark
      ? "linear-gradient(180deg, rgb(26,26,26) 0%, rgb(40,40,40) 100%)"
      : "linear-gradient(180deg, rgb(108,112,118) 0%, rgb(242,246,252) 100%)";

    document.body.style.background = bg;

    document.body.style.color = dark ? "rgb(245,245,245)" : "rgb(17,17,17)";
  }, [dark]);
  return null;
}
