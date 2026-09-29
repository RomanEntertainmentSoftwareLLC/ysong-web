export const AUDIO_INTAKE_MAX_BYTES = 100 * 1024 * 1024;
export const AUDIO_INTAKE_MAX_SECONDS = 15 * 60;

const supportedAudio: Record<string, string[]> = {
  mp3: ["audio/mpeg", "audio/mp3"],
  wav: ["audio/wav", "audio/x-wav", "audio/wave"],
  aac: ["audio/aac", "audio/x-aac", "audio/mp4"],
  m4a: ["audio/mp4", "audio/x-m4a"],
  ogg: ["audio/ogg", "application/ogg"],
  flac: ["audio/flac", "audio/x-flac"],
};

export function validateAudioIntakeFile(file: Pick<File, "name" | "size" | "type">): string | null {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  const acceptedTypes = supportedAudio[extension];
  if (!acceptedTypes) return "Choose an MP3, WAV, AAC, M4A, OGG, or FLAC audio file.";
  if (file.type && !acceptedTypes.includes(file.type.toLowerCase())) return "The file type does not match its audio extension.";
  if (file.size <= 0) return "The selected audio file is empty.";
  if (file.size > AUDIO_INTAKE_MAX_BYTES) return "Audio files must be 100 MB or smaller.";
  return null;
}

export function readAudioDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    const url = URL.createObjectURL(file);
    const cleanUp = () => URL.revokeObjectURL(url);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      const duration = audio.duration;
      cleanUp();
      if (!Number.isFinite(duration) || duration <= 0) reject(new Error("Could not read audio duration. Try a playable audio file."));
      else if (duration > AUDIO_INTAKE_MAX_SECONDS) reject(new Error("Audio must be 15 minutes or shorter."));
      else resolve(duration);
    };
    audio.onerror = () => { cleanUp(); reject(new Error("Could not read audio duration. Try a playable audio file.")); };
    audio.src = url;
  });
}
