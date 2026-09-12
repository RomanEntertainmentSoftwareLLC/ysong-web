import type { RoomAudienceEvent, RoomVenueTransport } from "./roomApi";

const CHANNEL_NAME = "ysong.room.venue.v1";
const EVENT_NAME = "ysong:room-venue-event";
const TRANSPORT_NAME = "ysong:room-venue-transport";

let channel: BroadcastChannel | null = null;
function getChannel() {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  if (!channel) channel = new BroadcastChannel(CHANNEL_NAME);
  return channel;
}

type VenueMessage =
  | { type: "event"; roomId: string; event: RoomAudienceEvent }
  | { type: "transport"; roomId: string; transport: RoomVenueTransport };

export function publishRoomVenueEvent(roomId: string, event: RoomAudienceEvent) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { roomId, event } }));
  try { getChannel()?.postMessage({ type: "event", roomId, event } satisfies VenueMessage); } catch { /* BroadcastChannel can be unavailable in restricted embeds. */ }
}

export function publishRoomVenueTransportLocal(roomId: string, transport: RoomVenueTransport) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(TRANSPORT_NAME, { detail: { roomId, transport } }));
  try { getChannel()?.postMessage({ type: "transport", roomId, transport } satisfies VenueMessage); } catch { /* BroadcastChannel can be unavailable in restricted embeds. */ }
}

export function subscribeRoomVenueEvents(listener: (roomId: string, event: RoomAudienceEvent) => void) {
  const onLocal = (event: Event) => {
    const detail = (event as CustomEvent<{roomId:string;event:RoomAudienceEvent}>).detail;
    if (detail?.roomId && detail.event) listener(detail.roomId, detail.event);
  };
  window.addEventListener(EVENT_NAME, onLocal);
  const bc = getChannel();
  const onChannel = (event: MessageEvent<VenueMessage>) => {
    if (event.data?.type === "event") listener(event.data.roomId, event.data.event);
  };
  bc?.addEventListener("message", onChannel as EventListener);
  return () => {
    window.removeEventListener(EVENT_NAME, onLocal);
    bc?.removeEventListener("message", onChannel as EventListener);
  };
}

export function subscribeRoomVenueTransport(listener: (roomId: string, transport: RoomVenueTransport) => void) {
  const onLocal = (event: Event) => {
    const detail = (event as CustomEvent<{roomId:string;transport:RoomVenueTransport}>).detail;
    if (detail?.roomId && detail.transport) listener(detail.roomId, detail.transport);
  };
  window.addEventListener(TRANSPORT_NAME, onLocal);
  const bc = getChannel();
  const onChannel = (event: MessageEvent<VenueMessage>) => {
    if (event.data?.type === "transport") listener(event.data.roomId, event.data.transport);
  };
  bc?.addEventListener("message", onChannel as EventListener);
  return () => {
    window.removeEventListener(TRANSPORT_NAME, onLocal);
    bc?.removeEventListener("message", onChannel as EventListener);
  };
}
