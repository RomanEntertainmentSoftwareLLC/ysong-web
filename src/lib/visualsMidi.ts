import type { BridgeMidiEvent } from "./bridgeApi";
import type { VisualSceneState } from "./visualsScene";

export type VisualMidiRuntime = Map<string, { value: number; updatedAt: number }>;

export function acceptVisualMidiEvent(scene: VisualSceneState, runtime: VisualMidiRuntime, event: BridgeMidiEvent, now = Date.now()) {
	if (!scene.midiModulation?.enabled || !event || !["noteon", "noteoff", "cc"].includes(event.kind)) return;
	for (const binding of scene.midiModulation.bindings) {
		if (!binding.enabled || !binding.target || (binding.device && binding.device !== event.device) || (binding.channel && binding.channel !== event.channel)) continue;
		if (binding.intent === "cc") {
			if (event.kind !== "cc" || event.controller !== binding.number) continue;
		} else if (event.note !== binding.number || event.kind === "cc") continue;
		const raw = binding.intent === "cc" ? event.value : binding.intent === "velocity" ? (event.kind === "noteon" ? event.velocity : 0) : (event.kind === "noteon" && (event.velocity ?? 0) > 0 ? 127 : 0);
		if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
		runtime.set(binding.id, { value: Math.max(0, Math.min(1, raw / 127)), updatedAt: now });
	}
}

export function visualMidiDeltas(scene: VisualSceneState, runtime: VisualMidiRuntime, connected: boolean, now = Date.now()) {
	const deltas = new Map<string, number>();
	if (!scene.midiModulation?.enabled || !connected) { runtime.clear(); return deltas; }
	const active = new Set(scene.midiModulation.bindings.map(binding => binding.id));
	for (const id of runtime.keys()) if (!active.has(id)) runtime.delete(id);
	for (const binding of scene.midiModulation.bindings) {
		if (!binding.enabled || !binding.target) { runtime.delete(binding.id); continue; }
		const state = runtime.get(binding.id);
		if (!state) continue;
		// Missing note-off or unplugged hardware cannot latch a scene indefinitely.
		const value = now - state.updatedAt > (binding.intent === "cc" ? 1000 : 2000) ? 0 : state.value;
		if (value) deltas.set(binding.target, (deltas.get(binding.target) ?? 0) + value * binding.amount);
	}
	return deltas;
}
