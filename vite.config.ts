import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

const workspaceRoot = fileURLToPath(new URL("../..", import.meta.url));

async function audioEngineOnline() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 650);
    const response = await fetch("http://127.0.0.1:8000/health", { signal: controller.signal });
    clearTimeout(timer);
    return response.ok;
  } catch {
    return false;
  }
}


async function aiDetectorOnline() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 650);
    const response = await fetch("http://127.0.0.1:8790/health", { signal: controller.signal });
    clearTimeout(timer);
    return response.ok;
  } catch {
    return false;
  }
}

function ysongAiDetectorPlugin(): Plugin {
  let child: ChildProcess | null = null;
  return {
    name: "ysong-ai-detector",
    apply: "serve",
    async configureServer(server) {
      if (process.env.YSONG_AUTO_AI_DETECTOR === "0" || await aiDetectorOnline()) return;
      const detectorDir = fileURLToPath(new URL("./local-services/ai-detector", import.meta.url));
      const bootstrap = path.join(detectorDir, "bootstrap.py");
      if (!fs.existsSync(bootstrap)) {
        server.config.logger.warn("YSong AI Detector service files are missing. AI Music Detector will stay offline.");
        return;
      }
      const customPython = process.env.YSONG_AI_DETECTOR_PYTHON?.trim();
      const python = customPython || (process.platform === "win32" ? "py" : "python3");
      const args = [...(!customPython && process.platform === "win32" ? ["-3"] : []), bootstrap, "--port", "8790"];
      server.config.logger.info("Starting YSong AI Detector on http://127.0.0.1:8790 …");
      try {
        child = spawn(python, args, {
          cwd: detectorDir,
          env: { ...process.env, PYTHONUNBUFFERED: "1" },
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });
        child.stdout?.on("data", data => server.config.logger.info(`[AI Detector] ${String(data).trimEnd()}`));
        child.stderr?.on("data", data => server.config.logger.info(`[AI Detector] ${String(data).trimEnd()}`));
        child.on("error", error => server.config.logger.warn(`Could not auto-start YSong AI Detector: ${error.message}`));
        child.on("exit", code => { if (code && code !== 0) server.config.logger.warn(`YSong AI Detector exited with code ${code}.`); child = null; });
        server.httpServer?.once("close", () => { if (child && !child.killed) child.kill(); });
      } catch (error) {
        server.config.logger.warn(`Could not auto-start YSong AI Detector: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  };
}

function ysongAudioEnginePlugin(): Plugin {
  let child: ChildProcess | null = null;
  return {
    name: "ysong-audio-engine",
    apply: "serve",
    async configureServer(server) {
      if (process.env.YSONG_AUTO_AUDIO_ENGINE === "0" || await audioEngineOnline()) return;

      const vocalDir = ["ysong-vocal-api", "ysong-vocal-api-root"]
        .map(name => path.join(workspaceRoot, name))
        .find(candidate => fs.existsSync(path.join(candidate, "app", "main.py")));
      if (!vocalDir) {
        server.config.logger.warn("YSong Audio Engine was not found beside ysong-web. Critique, Stem Restore and Audio Intelligence will stay offline.");
        return;
      }
      const criticDir = ["critic engine", "critic-engine", "critic_engine"]
        .map(name => path.join(workspaceRoot, name))
        .find(candidate => fs.existsSync(candidate));
      const customPython = process.env.YSONG_AUDIO_PYTHON?.trim();
      const python = customPython || (process.platform === "win32" ? "py" : "python3");
      const args = [...(!customPython && process.platform === "win32" ? ["-3"] : []), "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"];
      const pythonPath = [vocalDir, criticDir, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter);
      server.config.logger.info("Starting integrated YSong Audio Engine on http://127.0.0.1:8000 …");
      try {
        child = spawn(python, args, {
          cwd: vocalDir,
          env: { ...process.env, PYTHONPATH: pythonPath, PYTHONUNBUFFERED: "1" },
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });
        child.stdout?.on("data", data => server.config.logger.info(`[Audio Engine] ${String(data).trimEnd()}`));
        child.stderr?.on("data", data => server.config.logger.info(`[Audio Engine] ${String(data).trimEnd()}`));
        child.on("error", error => server.config.logger.warn(`Could not auto-start YSong Audio Engine: ${error.message}`));
        child.on("exit", code => { if (code && code !== 0) server.config.logger.warn(`YSong Audio Engine exited with code ${code}.`); child = null; });
        server.httpServer?.once("close", () => { if (child && !child.killed) child.kill(); });
      } catch (error) {
        server.config.logger.warn(`Could not auto-start YSong Audio Engine: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  };
}

export default defineConfig({
  plugins: [ysongAudioEnginePlugin(), ysongAiDetectorPlugin(), react(), tailwind()],
  // stb-vorbis@0.0.6 publishes a broken entry point. YSong uses SF2 for GM,
  // so keep SpessaSynth stable and make the unused Vorbis import resolvable.
  resolve: {
    alias: {
      "stb-vorbis": fileURLToPath(new URL("./src/vendor/stbVorbisShim.ts", import.meta.url)),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    open: false,
    fs: { allow: [workspaceRoot] },
    proxy: {
      "/api": { target: "http://127.0.0.1:8081", changeOrigin: false },
      "/auth": { target: "http://127.0.0.1:8081", changeOrigin: false },
      "/chat": { target: "http://127.0.0.1:8081", changeOrigin: false },
      "/audio-engine": {
        target: "http://127.0.0.1:8000",
        changeOrigin: false,
        rewrite: (urlPath) => urlPath.replace(/^\/audio-engine/, ""),
      },
      "/ai-detector": {
        target: "http://127.0.0.1:8790",
        changeOrigin: false,
        rewrite: (urlPath) => urlPath.replace(/^\/ai-detector/, ""),
      },
      "/bridge": {
        target: "http://127.0.0.1:39451",
        changeOrigin: false,
        rewrite: (urlPath) => urlPath.replace(/^\/bridge/, ""),
      },
    },
  },
});
