import { useEffect, useRef, useState } from "react";
import type { RoomMember } from "../lib/roomApi";

// A media provider owns connection state and remote streams. Rooms currently has no
// signaling provider, so this stage only owns local capture and preview.
export type RoomVideoConnectionState = "unavailable" | "connecting" | "connected" | "reconnecting" | "disconnected";
export type RoomVideoParticipant = { userId: string; stream: MediaStream | null };

type Props = {
  roomId: string;
  members: RoomMember[];
  meUserId?: string;
  meDisplayName?: string;
  connection?: RoomVideoConnectionState;
  participants?: RoomVideoParticipant[];
};

type CaptureState = "idle" | "requesting" | "ready" | "error";

function captureError(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") return "Camera or microphone permission was denied. Allow access in your browser settings and try again.";
    if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") return "No matching camera or microphone was found. Check your connected devices.";
    if (error.name === "NotReadableError" || error.name === "TrackStartError") return "A camera or microphone is in use or could not start.";
    if (error.name === "OverconstrainedError") return "The selected device is unavailable. Choose another device and try again.";
  }
  return "Could not start camera and microphone preview. Check browser permissions and try again.";
}

function VideoTile({ stream, label, local = false }: { stream: MediaStream | null; label: string; local?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    if (stream) void video.play().catch(() => {});
    return () => { video.srcObject = null; };
  }, [stream]);
  const hasVideo = !!stream?.getVideoTracks().some((track) => track.readyState === "live" && track.enabled);
  return <div className="relative aspect-video overflow-hidden rounded-xl bg-neutral-900 text-white flex items-center justify-center">
    <video ref={videoRef} autoPlay playsInline muted={local} className={`h-full w-full object-cover ${local ? "scale-x-[-1]" : ""} ${hasVideo ? "" : "hidden"}`} />
    {!hasVideo && <span className="px-3 text-center text-xs text-neutral-400">{local ? "Camera off" : "No video connected"}</span>}
    <span className="absolute bottom-2 left-2 rounded bg-black/70 px-2 py-1 text-xs">{label}</span>
  </div>;
}

export default function RoomVideoStage({ roomId, members, meUserId, meDisplayName, connection = "unavailable", participants = [] }: Props) {
  const [previewRequested, setPreviewRequested] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [cameraId, setCameraId] = useState("");
  const [micId, setMicId] = useState("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [capture, setCapture] = useState<CaptureState>("idle");
  const [error, setError] = useState("");
  const remote = members.filter((member) => member.userId !== meUserId);

  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    let active = true;
    const refresh = () => {
      void navigator.mediaDevices.enumerateDevices().then((list) => {
        if (active) setDevices(list.filter((device) => device.kind === "videoinput" || device.kind === "audioinput"));
      }).catch(() => {});
    };
    refresh();
    navigator.mediaDevices.addEventListener?.("devicechange", refresh);
    return () => { active = false; navigator.mediaDevices.removeEventListener?.("devicechange", refresh); };
  }, []);

  useEffect(() => {
    if (!previewRequested) return;
    let cancelled = false;
    let acquired: MediaStream | null = null;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCapture("error");
      setError("Camera and microphone access requires a supported browser and a secure connection.");
      return;
    }
    if (!cameraOn && !micOn) {
      setStream(null);
      setCapture("ready");
      return;
    }
    setCapture("requesting");
    setError("");
    setStream(null);
    void navigator.mediaDevices.getUserMedia({
      video: cameraOn ? (cameraId ? { deviceId: { exact: cameraId } } : true) : false,
      audio: micOn ? (micId ? { deviceId: { exact: micId } } : true) : false,
    }).then((next) => {
      if (cancelled) { next.getTracks().forEach((track) => track.stop()); return; }
      acquired = next;
      setStream(next);
      setCapture("ready");
      void navigator.mediaDevices.enumerateDevices().then((list) => {
        if (!cancelled) setDevices(list.filter((device) => device.kind === "videoinput" || device.kind === "audioinput"));
      }).catch(() => {});
    }).catch((reason: unknown) => {
      if (!cancelled) { setCapture("error"); setError(captureError(reason)); }
    });
    return () => { cancelled = true; acquired?.getTracks().forEach((track) => track.stop()); };
  }, [previewRequested, cameraOn, micOn, cameraId, micId]);

  const cameras = devices.filter((device) => device.kind === "videoinput");
  const microphones = devices.filter((device) => device.kind === "audioinput");
  const connectionText: Record<RoomVideoConnectionState, string> = {
    unavailable: "Video connection unavailable: no room media provider is configured.",
    connecting: "Connecting room video...",
    connected: "Room video connected.",
    reconnecting: "Reconnecting room video...",
    disconnected: "Room video disconnected.",
  };

  return <section aria-label="Room video" data-room-id={roomId} className="ys-rooms-video shrink-0 border-b border-neutral-200 dark:border-neutral-800 px-4 py-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h3 className="text-sm font-semibold">Room video</h3><p className="text-xs opacity-60" role="status">{connectionText[connection]}</p></div>
      <span className="text-[10px] opacity-60">Local preview stays on this device</span>
    </div>
    <div className="ys-rooms-video-grid mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-52 overflow-y-auto">
      <VideoTile stream={stream} label={`${meDisplayName || "You"} (preview)`} local />
      {remote.map((member) => <VideoTile key={member.userId} stream={participants.find((participant) => participant.userId === member.userId)?.stream ?? null} label={member.name} />)}
    </div>
    <div className="ys-rooms-video-controls mt-3 flex flex-wrap items-center gap-2">
      {!previewRequested ? <button type="button" onClick={() => setPreviewRequested(true)} className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs text-white">Start preview</button> : <>
        <button type="button" onClick={() => { setPreviewRequested(false); setStream(null); setCapture("idle"); setError(""); }} className="rounded-lg border px-3 py-1.5 text-xs">Stop preview</button>
        <button type="button" aria-pressed={cameraOn} onClick={() => setCameraOn((value) => !value)} className="rounded-lg border px-3 py-1.5 text-xs">Camera {cameraOn ? "on" : "off"}</button>
        <button type="button" aria-pressed={micOn} onClick={() => setMicOn((value) => !value)} className="rounded-lg border px-3 py-1.5 text-xs">Mic {micOn ? "on" : "off"}</button>
      </>}
      <label className="text-xs">Camera <select aria-label="Camera device" value={cameraId} onChange={(event) => setCameraId(event.target.value)} className="ml-1 max-w-36 rounded-lg border bg-transparent px-2 py-1"><option value="">Default</option>{cameras.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}</select></label>
      <label className="text-xs">Microphone <select aria-label="Microphone device" value={micId} onChange={(event) => setMicId(event.target.value)} className="ml-1 max-w-36 rounded-lg border bg-transparent px-2 py-1"><option value="">Default</option>{microphones.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>)}</select></label>
    </div>
    {capture === "requesting" && <p className="mt-2 text-xs" role="status">Requesting device permission...</p>}
    {capture === "ready" && <p className="mt-2 text-xs opacity-60" role="status">Preview ready. Your media is not sent to other members.</p>}
    {error && <p className="mt-2 text-xs text-red-500" role="alert">{error}</p>}
  </section>;
}
