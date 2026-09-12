import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { YSButton } from "./YSButton";
import {
	bridgeApi,
	type InstrumentCatalogEntry,
	type InstrumentMatchResult,
	type InstrumentParameterEntry,
	type InstrumentPresetEntry,
} from "../lib/bridgeApi";

export type InstrumentCatalogTrack = {
	id: string;
	name: string;
	type: "audio" | "instrument";
	vst3PluginPath?: string;
	vst3PluginName?: string;
};

type Props = {
	open: boolean;
	onClose: () => void;
	selectedTrack: InstrumentCatalogTrack | null;
	transportPlaying?: boolean;
	onAssignInstrument: (instrument: InstrumentCatalogEntry) => Promise<string | null>;
};

function messageOf(error: unknown, fallback: string) {
	return error instanceof Error && error.message ? error.message : fallback;
}

function splitDesired(value: string) {
	return value
		.split(/[;,|/\n]+|\s+/g)
		.map((part) => part.trim().toLowerCase())
		.filter((part) => part.length > 1)
		.filter((part, index, all) => all.indexOf(part) === index)
		.slice(0, 32);
}

function numberLabel(value: number) {
	if (!Number.isFinite(value)) return "0";
	if (Math.abs(value) >= 100) return value.toFixed(0);
	if (Math.abs(value) >= 10) return value.toFixed(1);
	return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

export default function InstrumentCatalogPanel({ open, onClose, selectedTrack, transportPlaying = false, onAssignInstrument }: Props) {
	const [instruments, setInstruments] = useState<InstrumentCatalogEntry[]>([]);
	const [matches, setMatches] = useState<InstrumentMatchResult[]>([]);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [desired, setDesired] = useState("");
	const [presets, setPresets] = useState<InstrumentPresetEntry[]>([]);
	const [parameters, setParameters] = useState<InstrumentParameterEntry[]>([]);
	const [parameterFilter, setParameterFilter] = useState("");
	const [snapshotName, setSnapshotName] = useState("Sound snapshot");
	const [snapshotTags, setSnapshotTags] = useState("");
	const [busy, setBusy] = useState<string | null>(null);
	const [status, setStatus] = useState("");
	const [catalogEngine, setCatalogEngine] = useState("");
	const auditionUrlRef = useRef<string | null>(null);
	const audioRef = useRef<HTMLAudioElement | null>(null);

	const selected = useMemo(() => instruments.find((item) => item.id === selectedId) ?? null, [instruments, selectedId]);
	const targetTrack = selectedTrack?.type === "instrument" ? selectedTrack : null;
	const selectedIsLoadedOnTarget = !!selected && !!targetTrack?.vst3PluginPath && targetTrack.vst3PluginPath.toLowerCase() === selected.path.toLowerCase();

	const visibleInstruments = useMemo(() => {
		if (matches.length > 0 && splitDesired(desired).length > 0) return matches.map((match) => match.instrument);
		const needle = desired.trim().toLowerCase();
		if (!needle) return instruments;
		return instruments.filter((instrument) =>
			[instrument.name, instrument.vendor ?? "", instrument.category ?? "", instrument.subCategories ?? "", ...instrument.tags]
				.join(" ").toLowerCase().includes(needle),
		);
	}, [desired, instruments, matches]);

	const filteredParameters = useMemo(() => {
		const needle = parameterFilter.trim().toLowerCase();
		return parameters.filter((parameter) => !needle || `${parameter.group} ${parameter.name} ${parameter.tags.join(" ")}`.toLowerCase().includes(needle)).slice(0, 160);
	}, [parameterFilter, parameters]);

	const refreshCatalog = async () => {
		setBusy("catalog");
		try {
			const result = await bridgeApi.getInstruments();
			setCatalogEngine(result.engine || "deterministic-catalog-v1");
			setInstruments(result.instruments ?? []);
			setSelectedId((current) => current && result.instruments.some((item) => item.id === current) ? current : (result.instruments[0]?.id ?? null));
			setStatus(`${result.instruments.length} Bridge instrument${result.instruments.length === 1 ? "" : "s"} available.`);
		} catch (error) {
			setStatus(messageOf(error, "Could not reach the Instrument Capability API."));
		} finally {
			setBusy(null);
		}
	};

	useEffect(() => {
		if (!open) return;
		void refreshCatalog();
	}, [open]);

	useEffect(() => {
		if (!open) return;
		const terms = splitDesired(desired);
		if (terms.length === 0) { setMatches([]); return; }
		const timer = window.setTimeout(() => {
			bridgeApi.matchInstruments(terms, 30)
				.then((result) => setMatches(result.matches ?? []))
				.catch(() => setMatches([]));
		}, 300);
		return () => window.clearTimeout(timer);
	}, [desired, open]);

	useEffect(() => {
		if (!open || !selected) { setPresets([]); return; }
		let cancelled = false;
		bridgeApi.getInstrumentPresets(selected.id)
			.then((result) => { if (!cancelled) setPresets(result.presets ?? []); })
			.catch((error) => { if (!cancelled) setStatus(messageOf(error, "Could not list presets.")); });
		return () => { cancelled = true; };
	}, [open, selected]);

	const refreshParameters = useCallback(async () => {
		if (!selected || !targetTrack || !selectedIsLoadedOnTarget) { setParameters([]); return; }
		setBusy("parameters");
		try {
			const result = await bridgeApi.getInstrumentParameters(selected.id, targetTrack.id);
			setParameters(result.parameters ?? []);
			setStatus(`${result.parameters.length} live parameter${result.parameters.length === 1 ? "" : "s"} exposed by ${selected.name}.`);
		} catch (error) {
			setStatus(messageOf(error, "Could not enumerate parameters."));
		} finally { setBusy(null); }
	}, [selected, targetTrack, selectedIsLoadedOnTarget]);

	useEffect(() => {
		if (!open || !selectedIsLoadedOnTarget) { setParameters([]); return; }
		void refreshParameters();
	}, [open, selectedIsLoadedOnTarget, refreshParameters]);

	useEffect(() => () => {
		try { audioRef.current?.pause(); } catch { /* ignore */ }
		if (auditionUrlRef.current) URL.revokeObjectURL(auditionUrlRef.current);
	}, []);

	if (!open) return null;

	const assign = async () => {
		if (!selected) return;
		setBusy("assign");
		try {
			const trackId = await onAssignInstrument(selected);
			if (!trackId) throw new Error("Select an instrument track in the DAW first.");
			setStatus(`${selected.name} loaded on the selected DAW track.`);
		} catch (error) {
			setStatus(messageOf(error, "Could not load instrument."));
		} finally { setBusy(null); }
	};

	const loadPreset = async (preset: InstrumentPresetEntry) => {
		if (!targetTrack || !selectedIsLoadedOnTarget || !preset.loadable) return;
		if (transportPlaying) { setStatus("Stop DAW playback before restoring complete plug-in state."); return; }
		setBusy(`preset:${preset.id}`);
		try {
			await bridgeApi.loadInstrumentPreset(targetTrack.id, preset.id);
			setStatus(`Restored ${preset.name}.`);
			await refreshParameters();
		} catch (error) { setStatus(messageOf(error, "Could not restore preset.")); }
		finally { setBusy(null); }
	};

	const captureSnapshot = async () => {
		if (!targetTrack || !selectedIsLoadedOnTarget) return;
		if (transportPlaying) { setStatus("Stop DAW playback before capturing complete plug-in state."); return; }
		setBusy("snapshot");
		try {
			await bridgeApi.captureInstrumentSnapshot(targetTrack.id, snapshotName.trim() || `${selected?.name ?? "Instrument"} Snapshot`, splitDesired(snapshotTags));
			const result = selected ? await bridgeApi.getInstrumentPresets(selected.id) : null;
			if (result) setPresets(result.presets ?? []);
			setStatus("Snapshot captured. Full plug-in state is preserved with a parameter fallback.");
		} catch (error) { setStatus(messageOf(error, "Could not capture snapshot.")); }
		finally { setBusy(null); }
	};

	const audition = async () => {
		if (!targetTrack || !selectedIsLoadedOnTarget) return;
		if (transportPlaying) { setStatus("Stop DAW playback before rendering an isolated instrument audition."); return; }
		setBusy("audition");
		try {
			const wav = await bridgeApi.renderInstrumentAudition(targetTrack.id, 3);
			try { audioRef.current?.pause(); } catch { /* ignore */ }
			if (auditionUrlRef.current) URL.revokeObjectURL(auditionUrlRef.current);
			const url = URL.createObjectURL(new Blob([wav], { type: "audio/wav" }));
			auditionUrlRef.current = url;
			const audio = new Audio(url);
			audioRef.current = audio;
			await audio.play();
			setStatus("Playing deterministic 3-second Bridge audition render.");
		} catch (error) { setStatus(messageOf(error, "Could not render audition.")); }
		finally { setBusy(null); }
	};

	const setParameter = async (parameter: InstrumentParameterEntry, value: number) => {
		if (!targetTrack || !selectedIsLoadedOnTarget) return;
		setParameters((current) => current.map((item) => item.id === parameter.id ? { ...item, currentValue: value } : item));
		try {
			await bridgeApi.setInstrumentParameter(targetTrack.id, parameter.id, value);
		} catch (error) {
			setStatus(messageOf(error, `Could not set ${parameter.name}.`));
			void refreshParameters();
		}
	};

	return (
		<div className="absolute inset-0 z-[86] bg-black/45 backdrop-blur-[2px] flex justify-end" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
			<section className="h-full w-full max-w-[1180px] bg-neutral-950 border-l border-white/10 shadow-2xl flex flex-col text-neutral-100">
				<header className="shrink-0 px-4 py-3 border-b border-white/10 flex items-start gap-3">
					<div className="min-w-0 flex-1">
						<div className="text-base font-semibold">Instrument Catalog</div>
						<div className="text-[11px] text-neutral-400">Deterministic Bridge capabilities · no AI model runs inside Bridge</div>
					</div>
					<div className="text-[10px] text-neutral-500 text-right">{catalogEngine || "Bridge catalog"}<br />{targetTrack ? `Target: ${targetTrack.name}` : "Select an instrument track"}</div>
					<YSButton className="h-8 px-3 rounded-lg" onClick={onClose}>Close</YSButton>
				</header>

				<div className="shrink-0 p-3 border-b border-white/10">
					<div className="flex gap-2">
						<input value={desired} onChange={(event) => setDesired(event.target.value)} placeholder="Desired sound: bright digital icy pluck short" className="min-w-0 flex-1 h-9 rounded-lg border border-white/10 bg-black/30 px-3 text-sm outline-none focus:border-cyan-300/50" />
						<YSButton disabled={busy === "catalog"} className="h-9 px-3 rounded-lg" onClick={() => void refreshCatalog()}>{busy === "catalog" ? "Refreshing…" : "Refresh"}</YSButton>
					</div>
					<div className="mt-1 text-[10px] text-neutral-500">Live matching is rule-based against installed plug-ins, inferred capability tags, and saved/discovered preset names. It is deliberately not labeled AI.</div>
				</div>

				<div className="min-h-0 flex-1 grid grid-cols-[minmax(260px,0.82fr)_minmax(360px,1.18fr)]">
					<div className="min-h-0 border-r border-white/10 overflow-y-auto">
						{visibleInstruments.length === 0 ? <div className="p-5 text-sm text-neutral-500">No matching instruments. Scan VST3 plug-ins in Settings first, or try broader sound terms.</div> : visibleInstruments.map((instrument) => {
							const match = matches.find((row) => row.instrument.id === instrument.id);
							const active = selectedId === instrument.id;
							return <button key={instrument.id} type="button" onClick={() => setSelectedId(instrument.id)} className={`w-full p-3 text-left border-b border-white/5 ${active ? "bg-cyan-500/10" : "hover:bg-white/[0.035]"}`}>
								<div className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-sm font-medium">{instrument.name}</span>{match && <span className="text-[10px] font-mono text-cyan-200">{match.score}</span>}</div>
								<div className="mt-0.5 text-[10px] text-neutral-500 truncate">{instrument.vendor || "Unknown vendor"}{instrument.version ? ` · ${instrument.version}` : ""}</div>
								<div className="mt-1 flex flex-wrap gap-1">{instrument.tags.slice(0, 8).map((tag) => <span key={tag} className="rounded border border-white/10 px-1.5 py-0.5 text-[9px] text-neutral-400">{tag}</span>)}</div>
								<div className="mt-1 text-[9px] text-neutral-600">{instrument.savedPresetCount} YSong snapshot{instrument.savedPresetCount === 1 ? "" : "s"} · {instrument.discoveredPresetCount} vendor preset file{instrument.discoveredPresetCount === 1 ? "" : "s"}</div>
							</button>;
						})}
					</div>

					<div className="min-h-0 overflow-y-auto p-4">
						{!selected ? <div className="text-sm text-neutral-500">Choose an instrument.</div> : <>
							<div className="flex flex-wrap items-start gap-3">
								<div className="min-w-0 flex-1"><div className="text-lg font-semibold">{selected.name}</div><div className="text-xs text-neutral-500">{selected.vendor || "Unknown vendor"} · {selected.format}{selected.category ? ` · ${selected.category}` : ""}</div><div className="mt-1 text-[10px] text-neutral-600 truncate" title={selected.path}>{selected.path}</div></div>
								<YSButton disabled={!targetTrack || busy === "assign" || selectedIsLoadedOnTarget} className="h-9 px-3 rounded-lg" onClick={() => void assign()}>{selectedIsLoadedOnTarget ? "Loaded on target" : busy === "assign" ? "Loading…" : "Load on selected track"}</YSButton>
								<YSButton disabled={!selectedIsLoadedOnTarget || transportPlaying || busy === "audition"} className="h-9 px-3 rounded-lg" onClick={() => void audition()}>{busy === "audition" ? "Rendering…" : "3s Audition"}</YSButton>
							</div>

							<div className="mt-4 grid grid-cols-1 xl:grid-cols-2 gap-3">
								<div className="rounded-xl border border-white/10 bg-white/[0.025] p-3">
									<div className="flex items-center justify-between gap-2"><div className="text-sm font-medium">Presets & Snapshots</div><span className="text-[10px] text-neutral-500">{presets.length}</span></div>
									<div className="mt-2 max-h-64 overflow-y-auto space-y-1.5">
										{presets.length === 0 && <div className="text-xs text-neutral-500">No saved or discoverable presets yet.</div>}
										{presets.map((preset) => <div key={preset.id} className="rounded-lg border border-white/8 bg-black/20 p-2">
											<div className="flex items-center gap-2"><div className="min-w-0 flex-1 truncate text-xs font-medium">{preset.name}</div><span className={`text-[9px] ${preset.loadable ? "text-emerald-300" : "text-amber-300"}`}>{preset.loadable ? "Loadable" : "Discover-only"}</span></div>
											<div className="text-[9px] text-neutral-500">{preset.source} · {preset.format}</div>
											{preset.detail && <div className="mt-1 text-[9px] text-neutral-600">{preset.detail}</div>}
											{preset.loadable && <YSButton disabled={!selectedIsLoadedOnTarget || transportPlaying || busy === `preset:${preset.id}`} className="mt-2 h-6 px-2 rounded-md text-[9px]" onClick={() => void loadPreset(preset)}>{busy === `preset:${preset.id}` ? "Restoring…" : "Restore"}</YSButton>}
										</div>)}
									</div>
									<div className="mt-3 border-t border-white/8 pt-3">
										<input value={snapshotName} onChange={(event) => setSnapshotName(event.target.value)} className="w-full h-8 rounded border border-white/10 bg-black/20 px-2 text-xs" placeholder="Snapshot name" />
										<input value={snapshotTags} onChange={(event) => setSnapshotTags(event.target.value)} className="mt-1.5 w-full h-8 rounded border border-white/10 bg-black/20 px-2 text-xs" placeholder="Optional tags: icy, pluck, bright" />
										<YSButton disabled={!selectedIsLoadedOnTarget || transportPlaying || busy === "snapshot"} className="mt-2 h-7 px-2 rounded-md text-[10px]" onClick={() => void captureSnapshot()}>{busy === "snapshot" ? "Capturing…" : "Capture Snapshot"}</YSButton>
									</div>
								</div>

								<div className="rounded-xl border border-white/10 bg-white/[0.025] p-3">
									<div className="flex items-center gap-2"><div className="text-sm font-medium flex-1">Parameters</div><YSButton disabled={!selectedIsLoadedOnTarget || busy === "parameters"} className="h-7 px-2 rounded-md text-[9px]" onClick={() => void refreshParameters()}>{busy === "parameters" ? "Reading…" : "Refresh"}</YSButton></div>
									<input value={parameterFilter} onChange={(event) => setParameterFilter(event.target.value)} placeholder="Filter: cutoff, resonance, attack, detune…" className="mt-2 w-full h-8 rounded border border-white/10 bg-black/20 px-2 text-xs" />
									{!selectedIsLoadedOnTarget ? <div className="mt-3 text-xs text-neutral-500">Load this instrument on the selected track to inspect its live parameter surface.</div> : <div className="mt-2 max-h-[430px] overflow-y-auto space-y-2">
										{filteredParameters.map((parameter) => <div key={parameter.id} className="rounded-lg border border-white/8 bg-black/20 p-2">
											<div className="flex items-center gap-2 text-[10px]"><span className="min-w-0 flex-1 truncate" title={parameter.name}>{parameter.name}</span><span className="text-neutral-500">{parameter.group}</span><span className="font-mono text-cyan-200">{numberLabel(parameter.currentValue)}</span></div>
											<input type="range" min={parameter.minValue} max={parameter.maxValue} step={Math.max((parameter.maxValue - parameter.minValue) / 1000, 0.0001)} value={parameter.currentValue} onChange={(event) => { const value = Number(event.target.value); setParameters((current) => current.map((item) => item.id === parameter.id ? { ...item, currentValue: value } : item)); }} onPointerUp={(event) => void setParameter(parameter, Number((event.currentTarget as HTMLInputElement).value))} onKeyUp={(event) => void setParameter(parameter, Number((event.currentTarget as HTMLInputElement).value))} className="mt-1 w-full accent-cyan-300" />
											{parameter.tags.length > 0 && <div className="text-[9px] text-neutral-600">{parameter.tags.join(" · ")}</div>}
										</div>)}
										{filteredParameters.length === 0 && <div className="text-xs text-neutral-500">No parameters match that filter.</div>}
									</div>}
								</div>
							</div>
						</>}
					</div>
				</div>

				<footer className="shrink-0 min-h-10 border-t border-white/10 px-4 py-2 text-[10px] text-neutral-400 flex items-center gap-3">
					<span className="min-w-0 flex-1 truncate">{status || "Bridge owns deterministic plug-in capabilities. AI Sound Designer uses this API as hands/ears, never as the AI brain."}</span>
					<span className="text-neutral-600">Snapshots before autonomous knob control are mandatory.</span>
				</footer>
			</section>
		</div>
	);
}
