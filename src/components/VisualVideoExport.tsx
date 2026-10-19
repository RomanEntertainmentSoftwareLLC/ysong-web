import { useEffect, useRef, useState } from "react";
import type { VisualSceneState } from "../lib/visualsScene";
import { syncVisualSceneToFrames } from "../lib/visualsViewportSync";

export function VisualVideoExport({ scene, duration }: { scene: VisualSceneState; duration: number }) {
	const frame = useRef<HTMLIFrameElement>(null);
	const recorder = useRef<MediaRecorder | null>(null);
	const cancel = useRef(false);
	const [width, setWidth] = useState(1280);
	const [fps, setFps] = useState(30);
	const [seconds, setSeconds] = useState(Math.min(30, Math.max(1, Math.ceil(duration))));
	const [busy, setBusy] = useState(false);
	const [progress, setProgress] = useState(0);
	const [message, setMessage] = useState("");
	const [frameKey, setFrameKey] = useState(0);
	const [ready, setReady] = useState(false);
	const supported = typeof MediaRecorder !== "undefined" && typeof HTMLCanvasElement !== "undefined" && !!HTMLCanvasElement.prototype.captureStream;
	const mime = supported ? ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find(type => MediaRecorder.isTypeSupported(type)) : undefined;
	useEffect(() => { if (frame.current?.contentDocument?.readyState === "complete") syncVisualSceneToFrames(scene, [frame.current], window.location.origin); }, [scene, frameKey]);
	useEffect(() => () => { cancel.current = true; if (recorder.current?.state === "recording") recorder.current.stop(); }, []);
	async function start() {
		if (!mime || busy) return;
		setMessage(""); setProgress(0); setBusy(true); cancel.current = false;
		const target = frame.current;
		let stream: MediaStream | undefined;
		let mediaRecorder: MediaRecorder | undefined;
		try {
			if (!ready || !target?.contentDocument) throw new Error("Program renderer is still loading.");
			syncVisualSceneToFrames(scene, [target], window.location.origin);
			const sources = Array.from(target.contentDocument.querySelectorAll("canvas"));
			if (sources.length < 2) throw new Error("Program canvases are still loading. Try again shortly.");
			const output = document.createElement("canvas"); output.width = width; output.height = width * 9 / 16;
			const context = output.getContext("2d");
			if (!context) throw new Error("Canvas recording is unavailable.");
			stream = output.captureStream(0);
			const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
			const chunks: BlobPart[] = [];
			mediaRecorder = new MediaRecorder(stream, { mimeType: mime }); recorder.current = mediaRecorder;
			const activeRecorder = mediaRecorder;
			mediaRecorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
			const finished = new Promise<void>((resolve, reject) => {
				activeRecorder.onerror = () => reject(new Error("Browser recording failed."));
				activeRecorder.onstop = () => { if (!cancel.current && chunks.length) {
					const url = URL.createObjectURL(new Blob(chunks, { type: mime }));
					const link = document.createElement("a"); link.href = url; link.download = "ysong-program.webm"; link.click();
					window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
				} resolve(); };
			});
			mediaRecorder.start(1000);
			const started = performance.now();
			const frameMs = 1000 / fps;
			let next = started;
			while (!cancel.current && performance.now() - started < seconds * 1000) {
				const now = performance.now();
				if (now < next) { await new Promise(resolve => setTimeout(resolve, Math.min(30, next - now))); continue; }
				context.fillStyle = "#000"; context.fillRect(0, 0, output.width, output.height);
				for (const source of sources.slice(0, 2)) context.drawImage(source, 0, 0, output.width, output.height);
				track.requestFrame();
				setProgress(Math.min(100, Math.round((now - started) / (seconds * 10))));
				next += frameMs;
				if (next < now) next = now + frameMs;
			}
			if (mediaRecorder.state === "recording") mediaRecorder.stop();
			await finished;
			setMessage(cancel.current ? "Recording canceled." : "WebM downloaded.");
		} catch (error) { setMessage(error instanceof Error ? error.message : "Recording failed."); }
		finally { if (mediaRecorder?.state === "recording") mediaRecorder.stop(); stream?.getTracks().forEach(track => track.stop()); recorder.current = null; setBusy(false); setProgress(0); }
	}
	return <div className="border-b border-white/10 p-3 text-[10px] text-neutral-400">
		<div className="mb-2 font-semibold uppercase tracking-wider text-cyan-300">Program video export</div>
		<div className="grid grid-cols-3 gap-2">
			<label>Resolution<select aria-label="Export resolution" disabled={busy} value={width} onChange={e => { setReady(false); setWidth(Number(e.target.value)); setFrameKey(v => v + 1); }} className="mt-1 w-full bg-[#121620]"><option value={640}>640×360</option><option value={1280}>1280×720</option><option value={1920}>1920×1080</option></select></label>
			<label>Frame rate<select aria-label="Export frame rate" disabled={busy} value={fps} onChange={e => setFps(Number(e.target.value))} className="mt-1 w-full bg-[#121620]"><option value={24}>24 fps</option><option value={30}>30 fps</option><option value={60}>60 fps</option></select></label>
			<label>Duration (seconds)<input aria-label="Export duration" disabled={busy} type="number" min={1} max={300} value={seconds} onChange={e => setSeconds(Number(e.target.value))} className="mt-1 w-full bg-[#121620]"/></label>
		</div>
		<label className="mt-2 block">Audio<select aria-label="Export audio" value="none" disabled className="ml-2 bg-[#121620]"><option value="none">None (video only)</option></select></label>
		<div className="mt-2 flex gap-2"><button disabled={!mime || !ready || busy || !Number.isInteger(seconds) || seconds < 1 || seconds > 300} onClick={() => void start()} className="rounded bg-cyan-700 px-2 py-1 text-white disabled:opacity-40">Record WebM</button>{busy && <button onClick={() => { cancel.current = true; }} className="rounded border border-white/20 px-2 py-1">Cancel</button>}</div>
		{busy && <div role="status">Recording {progress}%</div>}{message && <div role="status">{message}</div>}
		<div className="mt-2 text-neutral-500">Real time capture of the current Program Camera. Start playback before recording. Browser load or a hidden tab can drop frames. Selected resolution is the output size; adaptive renderer quality may lower detail. DOM overlays, media audio and offline timeline rendering are unsupported. {mime ? "" : "This browser cannot record WebM from a canvas."}</div>
		<iframe key={frameKey} ref={frame} onLoad={() => { setReady(true); syncVisualSceneToFrames(scene, [frame.current], window.location.origin); }} title="Video export renderer" src={`/visual-output?embedded=1&program=1&exportWidth=${width}`} className="pointer-events-none absolute h-px w-px opacity-0" tabIndex={-1} aria-hidden="true" />
	</div>;
}
