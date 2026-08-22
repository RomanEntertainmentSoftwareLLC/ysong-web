import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const workspaceRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  plugins: [react(), tailwind()],
  server: {
    // Listen on the LAN so a real phone/tablet can open YSong from the same Wi-Fi.
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    open: false,
    // Allow explicitly imported shared YSong workspace assets during local dev.
    fs: { allow: [workspaceRoot] },
    // Keep browser networking on the Vite origin. This works for localhost and
    // LAN-device URLs without hard-coding the desktop IP in frontend code.
    proxy: {
      "/api": { target: "http://127.0.0.1:8081", changeOrigin: false },
      "/auth": { target: "http://127.0.0.1:8081", changeOrigin: false },
      "/chat": { target: "http://127.0.0.1:8081", changeOrigin: false },
      // Browser -> Vite -> native YSong Bridge. This avoids cross-origin local
      // network restrictions and lets LAN test devices reach the desktop Bridge.
      "/bridge": {
        target: "http://127.0.0.1:39451",
        changeOrigin: false,
        rewrite: (path) => path.replace(/^\/bridge/, ""),
      },
    },
  },
});
