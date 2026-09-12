import type { VisualAudioFrame, VisualTransportState } from "./bridgeApi";

const CHANNEL_NAME = "ysong.visuals.realtime.v1";
const TRANSPORT_EVENT = "ysong:visuals-realtime-transport";
const AUDIO_EVENT = "ysong:visuals-realtime-audio";

let channel: BroadcastChannel | null = null;
function getChannel() {
	if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
	if (!channel) channel = new BroadcastChannel(CHANNEL_NAME);
	return channel;
}

type RealtimeMessage =
	| { type: "transport"; state: VisualTransportState }
	| { type: "audio"; frame: VisualAudioFrame };

export function publishLocalVisualTransport(state: VisualTransportState) {
	if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<VisualTransportState>(TRANSPORT_EVENT, { detail: state }));
	try { getChannel()?.postMessage({ type: "transport", state } satisfies RealtimeMessage); } catch { /* local realtime is best-effort */ }
}

export function publishLocalVisualAudio(frame: VisualAudioFrame) {
	if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<VisualAudioFrame>(AUDIO_EVENT, { detail: frame }));
	try { getChannel()?.postMessage({ type: "audio", frame } satisfies RealtimeMessage); } catch { /* local realtime is best-effort */ }
}

export function subscribeLocalVisualTransport(listener: (state: VisualTransportState) => void) {
	const localHandler = (event: Event) => listener((event as CustomEvent<VisualTransportState>).detail);
	window.addEventListener(TRANSPORT_EVENT, localHandler);
	const bc = getChannel();
	const channelHandler = (event: MessageEvent<RealtimeMessage>) => { if (event.data?.type === "transport") listener(event.data.state); };
	bc?.addEventListener("message", channelHandler as EventListener);
	return () => {
		window.removeEventListener(TRANSPORT_EVENT, localHandler);
		bc?.removeEventListener("message", channelHandler as EventListener);
	};
}

export function subscribeLocalVisualAudio(listener: (frame: VisualAudioFrame) => void) {
	const localHandler = (event: Event) => listener((event as CustomEvent<VisualAudioFrame>).detail);
	window.addEventListener(AUDIO_EVENT, localHandler);
	const bc = getChannel();
	const channelHandler = (event: MessageEvent<RealtimeMessage>) => { if (event.data?.type === "audio") listener(event.data.frame); };
	bc?.addEventListener("message", channelHandler as EventListener);
	return () => {
		window.removeEventListener(AUDIO_EVENT, localHandler);
		bc?.removeEventListener("message", channelHandler as EventListener);
	};
}

export function extrapolatedTransportPosition(state: VisualTransportState, nowUnixMs = Date.now()) {
	const base = Number.isFinite(state.positionSeconds) ? Math.max(0, state.positionSeconds) : 0;
	if (!state.playing || !state.updatedAt) return state.durationSeconds > 0 ? Math.min(base, state.durationSeconds) : base;
	const ageSeconds = Math.max(0, Math.min(1.5, (nowUnixMs - state.updatedAt) / 1000));
	const next = base + ageSeconds;
	return state.durationSeconds > 0 ? Math.min(next, state.durationSeconds) : next;
}
