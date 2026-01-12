import { createRoot } from "react-dom/client";
import { StrictMode } from "react";
import { ThemeProvider } from "./ThemeContext.tsx";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App.tsx";

const container = document.getElementById("root")!;
createRoot(container).render(
	<StrictMode>
		<BrowserRouter>
			<ThemeProvider>
				<App />
			</ThemeProvider>
		</BrowserRouter>
	</StrictMode>
);
