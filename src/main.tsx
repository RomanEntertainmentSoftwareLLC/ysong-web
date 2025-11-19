import { createRoot } from "react-dom/client";
import { StrictMode } from "react";
import { ThemeProvider } from "./ThemeContext";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App.tsx";

const container = document.getElementById("root")!;
createRoot(container).render(
    <StrictMode>
        <ThemeProvider>
            <BrowserRouter>
                <App />
            </BrowserRouter>
        </ThemeProvider>
    </StrictMode>
);
