import { useEffect, useRef, useState } from "react";
import { bridgeApi, BridgeRequestError, type BridgePlugin } from "../lib/bridgeApi";
import { YSButton } from "./YSButton";

export default function BridgeSettings() {
	const [online, setOnline] = useState(false);
	const [version, setVersion] = useState("");
	const [audioSummary, setAudioSummary] = useState("");
	const [probeReady, setProbeReady] = useState<boolean | null>(null);
	const [paths, setPaths] = useState<string[]>([]);
	const [draftPath, setDraftPath] = useState("");
	const [plugins, setPlugins] = useState<BridgePlugin[]>([]);
	const [busy, setBusy] = useState(false);
	const [pathBusy, setPathBusy] = useState(false);
	const [message, setMessage] = useState("");
	const pathListRef = useRef<HTMLDivElement | null>(null);
	const scrollToNewestRef = useRef(false);

	const errorMessage = (error: unknown, fallback: string) => {
		if (error instanceof BridgeRequestError && error.message) return error.message;
		if (error instanceof Error && error.message) return error.message;
		return fallback;
	};

	const refresh = async (showConfirmation = false) => {
		try {
			const [h, p, catalog] = await Promise.all([
				bridgeApi.health(),
				bridgeApi.getPluginPaths(),
				bridgeApi.getPlugins().catch(() => ({ ok: true as const, plugins: [] as BridgePlugin[] })),
			]);
			setOnline(!!h.ok);
			setVersion(h.version || "");
			setAudioSummary(h.audioDriverType ? `${h.audioDriverType}${h.selectedAudioDevice ? ` • ${h.selectedAudioDevice}` : " • not selected"}` : "");
			setProbeReady(h.vst3ProbeReady ?? null);
			setPaths(p.paths || []);
			setPlugins(catalog.plugins || []);
			if (showConfirmation) {
				const instrumentCount = (catalog.plugins || []).filter((plugin) => plugin.kind === "instrument" && plugin.loadable !== false).length;
				setMessage(`Bridge confirmed ${p.paths?.length || 0} saved plugin folder${p.paths?.length === 1 ? "" : "s"} and ${instrumentCount} loadable VST3 instrument${instrumentCount === 1 ? "" : "s"}.`);
			}
		} catch (error) {
			setOnline(false);
			setVersion("");
			setAudioSummary("");
			setProbeReady(null);
			if (showConfirmation) setMessage(errorMessage(error, "Could not reach YSong Bridge."));
		}
	};

	useEffect(() => {
		void refresh(false);
		const t = setInterval(() => {
			void bridgeApi.health()
				.then((h) => {
					setOnline(!!h.ok);
					setVersion(h.version || "");
					setAudioSummary(h.audioDriverType ? `${h.audioDriverType}${h.selectedAudioDevice ? ` • ${h.selectedAudioDevice}` : " • not selected"}` : "");
					setProbeReady(h.vst3ProbeReady ?? null);
				})
				.catch(() => { setOnline(false); setVersion(""); setAudioSummary(""); setProbeReady(null); });
		}, 5000);
		return () => clearInterval(t);
	}, []);

	useEffect(() => {
		if (!scrollToNewestRef.current || !pathListRef.current) return;
		pathListRef.current.scrollTop = pathListRef.current.scrollHeight;
		scrollToNewestRef.current = false;
	}, [paths.length]);

	const addDraftPath = async () => {
		const p = draftPath.trim();
		if (!p || pathBusy) return;
		const normalized = p.replace(/[\\/]+$/, "").toLowerCase();
		if (paths.some((x) => x.replace(/[\\/]+$/, "").toLowerCase() === normalized)) {
			setMessage("That plugin folder is already in the saved list.");
			setDraftPath("");
			return;
		}

		setPathBusy(true);
		setMessage("Saving plugin folder to YSong Bridge…");
		try {
			const saved = await bridgeApi.addPluginPath(p);
			scrollToNewestRef.current = true;
			setPaths(saved.paths || []);
			setDraftPath("");
			setOnline(true);
			setMessage(`Saved. ${saved.paths?.length || 0} plugin folder${saved.paths?.length === 1 ? "" : "s"} stored by the Bridge.`);
		} catch (error) {
			// Do NOT show an optimistic folder that the Bridge did not confirm. If it is
			// visible here, it is genuinely persisted by the native Bridge process.
			setMessage(`Folder was NOT saved: ${errorMessage(error, "unknown Bridge error")}`);
		}
		finally {
			setPathBusy(false);
		}
	};

	const removePath = async (path: string) => {
		if (pathBusy) return;
		setPathBusy(true);
		setMessage("Removing plugin folder…");
		try {
			const saved = await bridgeApi.removePluginPath(path);
			setPaths(saved.paths || []);
			setMessage(`Removed. ${saved.paths?.length || 0} plugin folder${saved.paths?.length === 1 ? "" : "s"} remain saved.`);
		} catch (error) {
			setMessage(`Folder was NOT removed: ${errorMessage(error, "unknown Bridge error")}`);
		} finally {
			setPathBusy(false);
		}
	};

	const scan = async () => {
		setBusy(true);
		setMessage(`Scanning ${paths.length} saved folder${paths.length === 1 ? "" : "s"} for VST3 plugins… this can take a while.`);
		try {
			const r = await bridgeApi.scanPlugins();
			const scanned = r.plugins || [];
			setPlugins(scanned);
			setOnline(true);
			const instruments = scanned.filter((plugin) => plugin.kind === "instrument" && plugin.loadable !== false).length;
			const effects = scanned.filter((plugin) => plugin.kind === "effect" && plugin.loadable !== false).length;
			const probeMissing = scanned.filter((plugin) => plugin.kind === "probe-missing").length;
			const failed = scanned.filter((plugin) => plugin.kind !== "probe-missing" && (plugin.loadable === false || plugin.kind === "failed" || plugin.kind === "crashed")).length;
			if (probeMissing > 0) {
				setProbeReady(false);
				setMessage(`Found ${scanned.length} VST3 files, but the Bridge probe helper is missing. Rebuild and restart YSong Bridge, then scan again.`);
			} else {
				setProbeReady(true);
				setMessage(`Found ${scanned.length} VST3 plugins • ${instruments} instrument${instruments === 1 ? "" : "s"} • ${effects} effect${effects === 1 ? "" : "s"}${failed ? ` • ${failed} failed probe${failed === 1 ? "" : "s"}` : ""}.`);
			}
		} catch (error) {
			// A long/failed scan is not proof that the health endpoint is offline.
			setMessage(`VST3 scan failed: ${errorMessage(error, "unknown Bridge error")}`);
		} finally {
			setBusy(false);
		}
	};

	return (
		<section className="border rounded-2xl p-4 md:p-5 bg-white/80 dark:bg-neutral-900/60 border-neutral-200 dark:border-neutral-800 shadow-sm">
			<header className="flex flex-wrap items-start justify-between gap-3 mb-4">
				<div>
					<h2 className="text-lg font-semibold">YSong Bridge</h2>
					<p className="text-sm text-neutral-600 dark:text-neutral-400">Native audio, ASIO/WASAPI/DirectSound/MME routing, and plugin services.</p>
					{audioSummary && <p className="mt-1 text-xs text-neutral-500">Audio: {audioSummary}</p>}
				</div>
				<div className={`rounded-full px-3 py-1 text-xs border ${online ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-neutral-300 dark:border-neutral-700 text-neutral-500"}`}>
					● {online ? `Connected${version ? ` • v${version}` : ""}` : "Offline"}
				</div>
			</header>

			{online && probeReady === false && (
				<div className="mb-3 rounded-xl border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
					VST3 probe helper is missing beside YSong Bridge. Rebuild/restart Bridge before scanning; plug-ins cannot be classified until the helper is present.
				</div>
			)}

			<div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-3">
				<div className="flex items-center justify-between gap-3 mb-2">
					<div className="font-medium">Plugin Locations</div>
					<div className="text-[11px] text-neutral-500">{paths.length} folder{paths.length === 1 ? "" : "s"}</div>
				</div>

				<div ref={pathListRef} className="max-h-64 overflow-y-scroll pr-1 space-y-2" style={{ scrollbarGutter: "stable" }}>
					{paths.map((path) => (
						<div key={path.toLowerCase()} className="flex items-center gap-2 rounded-lg bg-neutral-100 dark:bg-neutral-950/60 px-3 py-2 text-sm">
							<span className="truncate flex-1" title={path}>{path}</span>
							<button type="button" disabled={pathBusy} onClick={() => void removePath(path)} className="text-red-500 disabled:opacity-40 text-xs">Remove</button>
						</div>
					))}
				</div>

				<div className="flex gap-2 mt-2">
					<input
						value={draftPath}
						onChange={(e) => setDraftPath(e.target.value)}
						onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addDraftPath(); } }}
						placeholder="C:\\Program Files\\Common Files\\VST3"
						className="min-w-0 flex-1 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 px-3 py-2 text-sm"
					/>
					<YSButton disabled={!online || !draftPath.trim() || pathBusy} onClick={() => void addDraftPath()} className="rounded-lg border px-3">{pathBusy ? "Saving…" : "Add"}</YSButton>
				</div>
			</div>

			<div className="mt-3 flex flex-wrap items-center gap-2">
				<YSButton onClick={() => void refresh(true)} className="rounded-lg border px-3 py-1.5">Check Bridge</YSButton>
				<YSButton disabled={!online} onClick={() => void bridgeApi.openBridgeUi().catch((error) => setMessage(errorMessage(error, "Could not open Bridge app.")))} className="rounded-lg border px-3 py-1.5">Open Bridge</YSButton>
				<YSButton disabled={!online || busy} onClick={() => void scan()} className="rounded-lg border px-3 py-1.5">{busy ? "Scanning…" : "Scan VST3"}</YSButton>
				{message && <span className="text-xs text-neutral-500">{message}</span>}
			</div>

			{plugins.length > 0 && (
				<div className="mt-3 max-h-56 overflow-y-auto rounded-xl border border-neutral-200 dark:border-neutral-800 divide-y divide-neutral-200 dark:divide-neutral-800" style={{ scrollbarGutter: "stable" }}>
					{plugins.map((plugin) => {
						const label = plugin.kind === "instrument" ? "Instrument" : plugin.kind === "effect" ? "Effect" : plugin.kind === "probe-missing" ? "Probe missing" : plugin.kind === "crashed" ? "Crashed" : plugin.kind === "failed" ? "Failed" : "Unknown";
						const probeMissing = plugin.kind === "probe-missing";
						const bad = plugin.loadable === false || plugin.kind === "failed" || plugin.kind === "crashed";
						return (
							<div key={plugin.path} className="px-3 py-2">
								<div className="flex items-center gap-2">
									<div className="min-w-0 flex-1 text-sm font-medium truncate">{plugin.name}</div>
									<span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${probeMissing ? "border-amber-400/40 text-amber-500" : bad ? "border-red-400/40 text-red-500" : plugin.kind === "instrument" ? "border-sky-400/40 text-sky-500" : "border-neutral-300 dark:border-neutral-700 text-neutral-500"}`}>{label}</span>
								</div>
								{plugin.vendor && <div className="text-[11px] text-neutral-400">{plugin.vendor}{plugin.version ? ` • ${plugin.version}` : ""}</div>}
								<div className="text-[11px] text-neutral-500 truncate" title={plugin.path}>{plugin.path}</div>
								{plugin.error && <div className="mt-1 text-[11px] text-red-500">{plugin.error}</div>}
							</div>
						);
					})}
				</div>
			)}
		</section>
	);
}
