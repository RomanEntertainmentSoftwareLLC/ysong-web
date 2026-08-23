import { promises as fs, createWriteStream } from "node:fs";
import path from "node:path";
import process from "node:process";
import http from "node:http";
import https from "node:https";

const root = process.cwd();
const publicDir = path.join(root, "public");
const soundfontDir = path.join(publicDir, "soundfonts");
await fs.mkdir(soundfontDir, { recursive: true });

const workletSource = path.join(root, "node_modules", "spessasynth_lib", "dist", "spessasynth_processor.min.js");
const workletTarget = path.join(publicDir, "spessasynth_processor.min.js");
try {
  await fs.copyFile(workletSource, workletTarget);
  console.log(`[YSong GM] Worklet ready: ${path.relative(root, workletTarget)}`);
} catch (error) {
  console.error(`[YSong GM] Could not copy SpessaSynth worklet from ${workletSource}.`);
  throw error;
}

const bankTarget = path.join(soundfontDir, "GeneralUser-GS.sf2");
const bankTemp = `${bankTarget}.download`;
const minimumExpectedBytes = 20 * 1024 * 1024;

async function isUsableSoundFont(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile() && stat.size >= minimumExpectedBytes;
  } catch {
    return false;
  }
}

function downloadToFile(url, destination, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 8) {
      reject(new Error("Too many redirects while downloading GeneralUser GS."));
      return;
    }

    const client = url.startsWith("https:") ? https : http;
    const request = client.get(
      url,
      {
        headers: {
          "User-Agent": "YSong-v31-GM-Setup/1.0",
          Accept: "application/octet-stream,*/*",
        },
      },
      (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume();
          const redirected = new URL(response.headers.location, url).toString();
          resolve(downloadToFile(redirected, destination, redirectCount + 1));
          return;
        }

        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`HTTP ${response.statusCode} from ${url}`));
          return;
        }

        const output = createWriteStream(destination, { flags: "w" });
        let received = 0;
        let nextProgress = 5 * 1024 * 1024;

        response.on("data", (chunk) => {
          received += chunk.length;
          if (received >= nextProgress) {
            console.log(`[YSong GM] Downloaded ${(received / 1024 / 1024).toFixed(1)} MB...`);
            nextProgress += 5 * 1024 * 1024;
          }
        });

        response.pipe(output);

        output.on("finish", () => {
          output.close(() => resolve(received));
        });
        output.on("error", reject);
        response.on("error", reject);
      },
    );

    // Node fetch/undici used a 10 second connect timeout on the previous setup.
    // Give slow GitHub/CDN connections enough time instead of aborting a 31 MB asset.
    request.setTimeout(120_000, () => {
      request.destroy(new Error(`Download stalled for 120 seconds: ${url}`));
    });
    request.on("error", reject);
  });
}

async function downloadWithRetries() {
  const sources = [
    "https://cdn.jsdelivr.net/gh/mrbumpy409/GeneralUser-GS@main/GeneralUser-GS.sf2",
    "https://github.com/mrbumpy409/GeneralUser-GS/raw/refs/heads/main/GeneralUser-GS.sf2",
    "https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/main/GeneralUser-GS.sf2",
  ];

  await fs.rm(bankTemp, { force: true });
  const failures = [];

  for (const source of sources) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        console.log(`[YSong GM] Download source ${sources.indexOf(source) + 1}/${sources.length}, attempt ${attempt}/3...`);
        const received = await downloadToFile(source, bankTemp);
        if (received < minimumExpectedBytes) {
          throw new Error(`download was unexpectedly small (${(received / 1024 / 1024).toFixed(1)} MB)`);
        }
        await fs.rename(bankTemp, bankTarget);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${source} attempt ${attempt}: ${message}`);
        console.warn(`[YSong GM] Attempt failed: ${message}`);
        await fs.rm(bankTemp, { force: true });
        if (attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 2500));
        }
      }
    }
  }

  throw new Error(`Could not download GeneralUser GS after retries.\n${failures.join("\n")}`);
}

if (await isUsableSoundFont(bankTarget)) {
  const stat = await fs.stat(bankTarget);
  console.log(`[YSong GM] SoundFont already present: ${path.relative(root, bankTarget)} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
} else {
  await fs.rm(bankTarget, { force: true });
  console.log("[YSong GM] Downloading GeneralUser GS SoundFont (~31 MB) with retries/fallbacks...");
  await downloadWithRetries();
  const stat = await fs.stat(bankTarget);
  console.log(`[YSong GM] SoundFont ready: ${path.relative(root, bankTarget)} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
}

const notice = `GeneralUser GS\n\nYSong downloads GeneralUser GS from the upstream project for local General MIDI playback.\nProject: https://github.com/mrbumpy409/GeneralUser-GS\nAuthor: S. Christian Collins\nLicense: see the upstream GeneralUser GS license/documentation.\n`;
await fs.writeFile(path.join(soundfontDir, "GENERALUSER-NOTICE.txt"), notice, "utf8");
