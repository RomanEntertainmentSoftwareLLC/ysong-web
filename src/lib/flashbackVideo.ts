import type { FlashbackData } from "./flashback";
import { flashbackAudioUrl } from "./flashback";

export type FlashbackTheme = "midnight" | "aurora" | "ember" | "mono";

const THEMES: Record<FlashbackTheme, { a: string; b: string; accent: string; text: string; muted: string }> = {
	midnight: { a: "#070815", b: "#28154f", accent: "#9f7aea", text: "#ffffff", muted: "#b9b7c9" },
	aurora: { a: "#041817", b: "#083b45", accent: "#6ee7d8", text: "#ffffff", muted: "#b8d8d5" },
	ember: { a: "#1b0806", b: "#4a160b", accent: "#fb923c", text: "#ffffff", muted: "#e2c1b1" },
	mono: { a: "#050505", b: "#252525", accent: "#ffffff", text: "#ffffff", muted: "#b8b8b8" },
};

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
	const words = String(text || "").split(/\s+/).filter(Boolean);
	const lines: string[] = [];
	let line = "";
	for (const word of words) {
		const next = line ? `${line} ${word}` : word;
		if (line && ctx.measureText(next).width > maxWidth) { lines.push(line); line = word; }
		else line = next;
	}
	if (line) lines.push(line);
	return lines;
}

function formatMinutes(seconds: number) {
	return Math.max(0, Math.round((Number(seconds) || 0) / 60)).toLocaleString();
}

function drawBackground(ctx: CanvasRenderingContext2D, width: number, height: number, theme: FlashbackTheme, t: number) {
	const p = THEMES[theme];
	const gradient = ctx.createLinearGradient(0, 0, width, height);
	gradient.addColorStop(0, p.a);
	gradient.addColorStop(1, p.b);
	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, width, height);
	ctx.globalAlpha = 0.15;
	for (let i = 0; i < 18; i++) {
		const x = ((i * 137 + t * (18 + (i % 5) * 6)) % (width + 240)) - 120;
		const y = (i * 211) % height;
		ctx.beginPath();
		ctx.arc(x, y, 45 + (i % 4) * 28, 0, Math.PI * 2);
		ctx.fillStyle = i % 3 === 0 ? p.accent : "#ffffff";
		ctx.fill();
	}
	ctx.globalAlpha = 1;
}

function drawBrand(ctx: CanvasRenderingContext2D, p: (typeof THEMES)[FlashbackTheme], label: string) {
	ctx.fillStyle = p.muted;
	ctx.font = "600 25px system-ui, sans-serif";
	ctx.fillText("YSONG FLASHBACK", 64, 82);
	ctx.textAlign = "right";
	ctx.fillText(label.toUpperCase(), 656, 82);
	ctx.textAlign = "left";
}

function drawCenteredTitle(ctx: CanvasRenderingContext2D, p: (typeof THEMES)[FlashbackTheme], title: string, subtitle = "") {
	ctx.textAlign = "center";
	ctx.fillStyle = p.text;
	ctx.font = "800 64px system-ui, sans-serif";
	const lines = wrapText(ctx, title, 600);
	let y = 500 - Math.max(0, lines.length - 1) * 38;
	for (const line of lines.slice(0, 4)) { ctx.fillText(line, 360, y); y += 78; }
	if (subtitle) {
		ctx.fillStyle = p.muted;
		ctx.font = "500 30px system-ui, sans-serif";
		ctx.fillText(subtitle, 360, y + 20);
	}
	ctx.textAlign = "left";
}

function drawMetric(ctx: CanvasRenderingContext2D, p: (typeof THEMES)[FlashbackTheme], value: string, label: string, detail = "") {
	ctx.textAlign = "center";
	ctx.fillStyle = p.accent;
	ctx.font = "900 110px system-ui, sans-serif";
	ctx.fillText(value, 360, 560);
	ctx.fillStyle = p.text;
	ctx.font = "700 42px system-ui, sans-serif";
	ctx.fillText(label, 360, 630);
	if (detail) {
		ctx.fillStyle = p.muted;
		ctx.font = "500 27px system-ui, sans-serif";
		const lines = wrapText(ctx, detail, 590);
		lines.slice(0, 3).forEach((line, i) => ctx.fillText(line, 360, 700 + i * 38));
	}
	ctx.textAlign = "left";
}

function drawRankList(ctx: CanvasRenderingContext2D, p: (typeof THEMES)[FlashbackTheme], title: string, rows: string[]) {
	ctx.fillStyle = p.text;
	ctx.font = "800 54px system-ui, sans-serif";
	ctx.fillText(title, 64, 300);
	rows.slice(0, 5).forEach((row, i) => {
		const y = 390 + i * 118;
		ctx.fillStyle = i === 0 ? p.accent : p.text;
		ctx.font = "800 40px system-ui, sans-serif";
		ctx.fillText(String(i + 1).padStart(2, "0"), 72, y);
		ctx.font = "650 34px system-ui, sans-serif";
		const clipped = row.length > 30 ? `${row.slice(0, 29)}…` : row;
		ctx.fillText(clipped, 155, y);
		ctx.globalAlpha = 0.14;
		ctx.fillRect(155, y + 26, 480, 2);
		ctx.globalAlpha = 1;
	});
}

function drawFrame(ctx: CanvasRenderingContext2D, data: FlashbackData, theme: FlashbackTheme, elapsed: number, slideDuration: number) {
	const p = THEMES[theme];
	const slides = 7;
	const raw = elapsed / slideDuration;
	const index = Math.min(slides - 1, Math.floor(raw));
	const local = Math.max(0, Math.min(1, raw - index));
	drawBackground(ctx, 720, 1280, theme, elapsed);
	drawBrand(ctx, p, data.label);

	ctx.save();
	const fade = Math.min(1, local * 4, (1 - local) * 4 + (index === slides - 1 ? 1 : 0));
	ctx.globalAlpha = Math.max(0.18, fade);
	const lift = (1 - Math.min(1, local * 2.2)) * 30;
	ctx.translate(0, lift);
	const topTrack = data.topTracks[0];
	if (index === 0) drawCenteredTitle(ctx, p, data.period === "year" ? `${data.year} was yours.` : "Your listening story.", "One recap. Zero filler.");
	else if (index === 1) drawMetric(ctx, p, formatMinutes(data.totals.listenSeconds), "minutes with music", `${data.totals.plays.toLocaleString()} plays across ${data.totals.listeningDays.toLocaleString()} listening days`);
	else if (index === 2) drawCenteredTitle(ctx, p, topTrack?.title || "Your top song is waiting", topTrack ? `${topTrack.artistName} · ${topTrack.plays.toLocaleString()} plays` : "Listen in YSong World to build your Flashback.");
	else if (index === 3) drawRankList(ctx, p, "Your artists", data.topArtists.map((row) => row.name));
	else if (index === 4) drawRankList(ctx, p, "Your genres", data.topGenres.map((row) => row.name));
	else if (index === 5) drawMetric(ctx, p, data.discoveries.artists.toLocaleString(), "new artists discovered", `${data.discoveries.tracks.toLocaleString()} new songs entered your orbit`);
	else drawMetric(ctx, p, `${data.totals.longestStreakDays}`, "day listening streak", `${data.totals.uniqueTracks.toLocaleString()} songs · ${data.totals.uniqueArtists.toLocaleString()} artists · YSong`);
	ctx.restore();

	ctx.fillStyle = "rgba(255,255,255,.16)";
	ctx.fillRect(64, 1180, 592, 4);
	ctx.fillStyle = p.accent;
	ctx.fillRect(64, 1180, 592 * Math.min(1, elapsed / (slideDuration * slides)), 4);
}

async function loadSoundtrack(trackId: string) {
	if (!trackId) return null;
	const token = (() => { try { return localStorage.getItem("ys_token") || localStorage.getItem("ysong_auth_token") || ""; } catch { return ""; } })();
	const res = await fetch(flashbackAudioUrl(trackId), {
		credentials: "include",
		headers: token ? { Authorization: `Bearer ${token}` } : undefined,
	});
	if (!res.ok) return null;
	return res.blob();
}

export async function renderFlashbackVideo(data: FlashbackData, theme: FlashbackTheme, onProgress?: (value: number) => void) {
	if (typeof MediaRecorder === "undefined") throw new Error("Video export is not supported by this browser.");
	const canvas = document.createElement("canvas");
	canvas.width = 720;
	canvas.height = 1280;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Could not create the Flashback renderer.");
	const capture = (canvas as HTMLCanvasElement & { captureStream?: (fps?: number) => MediaStream }).captureStream;
	if (!capture) throw new Error("Canvas video capture is not supported by this browser.");
	const stream = capture.call(canvas, 30);
	let audio: HTMLAudioElement | null = null;
	let audioUrl = "";
	let audioContext: AudioContext | null = null;
	let audioDestination: MediaStreamAudioDestinationNode | null = null;
	try {
		const soundtrack = await loadSoundtrack(data.topTracks[0]?.id || "").catch(() => null);
		if (soundtrack) {
			audioUrl = URL.createObjectURL(soundtrack);
			audio = new Audio(audioUrl);
			audio.preload = "auto";
			audioContext = new AudioContext();
			await audioContext.resume();
			const source = audioContext.createMediaElementSource(audio);
			audioDestination = audioContext.createMediaStreamDestination();
			source.connect(audioDestination);
			audioDestination.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
		}

		const mimeType = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((type) => MediaRecorder.isTypeSupported(type)) || "";
		const recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 5_000_000 } : { videoBitsPerSecond: 5_000_000 });
		const chunks: BlobPart[] = [];
		recorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
		const stopped = new Promise<void>((resolve, reject) => {
			recorder.onstop = () => resolve();
			recorder.onerror = () => reject(new Error("Flashback video recorder failed."));
		});
		const slideDuration = 1.6;
		const totalDuration = slideDuration * 7;
		recorder.start(250);
		if (audio) { audio.currentTime = 0; await audio.play().catch(() => {}); }
		const started = performance.now();
		await new Promise<void>((resolve) => {
			const frame = (now: number) => {
				const elapsed = Math.min(totalDuration, (now - started) / 1000);
				drawFrame(ctx, data, theme, elapsed, slideDuration);
				onProgress?.(elapsed / totalDuration);
				if (elapsed >= totalDuration) { resolve(); return; }
				requestAnimationFrame(frame);
			};
			requestAnimationFrame(frame);
		});
		if (audio) audio.pause();
		recorder.stop();
		await stopped;
		onProgress?.(1);
		return new Blob(chunks, { type: recorder.mimeType || "video/webm" });
	} finally {
		if (audio) { audio.pause(); audio.src = ""; }
		if (audioUrl) URL.revokeObjectURL(audioUrl);
		stream.getTracks().forEach((track) => track.stop());
		if (audioDestination) audioDestination.stream.getTracks().forEach((track) => track.stop());
		if (audioContext && audioContext.state !== "closed") void audioContext.close();
	}
}
