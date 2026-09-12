export type PlaybackOwner = "daw" | "world";

const STORAGE_KEY = "ysong:last-playback-owner";
const EVENT_NAME = "ysong:playback-owner";

function readStored(): PlaybackOwner {
  try {
    return localStorage.getItem(STORAGE_KEY) === "world" ? "world" : "daw";
  } catch {
    return "daw";
  }
}

let owner: PlaybackOwner = readStored();

export function getPlaybackOwner(): PlaybackOwner {
  return owner;
}

export function claimPlaybackOwner(next: PlaybackOwner) {
  if (owner === next) return;
  owner = next;
  try { localStorage.setItem(STORAGE_KEY, next); } catch {}
  window.dispatchEvent(new CustomEvent<PlaybackOwner>(EVENT_NAME, { detail: next }));
}

export function subscribePlaybackOwner(listener: (owner: PlaybackOwner) => void) {
  listener(owner);
  const handler = (event: Event) => listener((event as CustomEvent<PlaybackOwner>).detail);
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
