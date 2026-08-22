import { YSButton } from "./YSButton";

const TICKS_PER_BEAT = 96;

type Props = {
  playheadPosBars: number;
  isPlaying: boolean;
  loopEnabled: boolean;
  bpm: number;
  sigNum: number;
  sigDen: number;
  onReturnStart: () => void;
  onStop: () => void;
  onTogglePlay: () => void;
  onRecord?: () => void;
  onToggleKeyboard?: () => void;
  keyboardOpen?: boolean;
  recording?: boolean;
  onToggleLoop: () => void;
  onJumpEnd: () => void;
  onBpmChange: (value: number) => void;
  onSignatureChange: (num: number, den: number) => void;
  className?: string;
  compact?: boolean;
};

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function transportStrings(playheadPosBars: number, bpm: number, sigNum: number, sigDen: number) {
  const beatsPerBar = Math.max(1, sigNum);
  const denom = Math.max(1, sigDen);
  const qnPerBeat = 4 / denom;
  const beatSec = (60 / Math.max(1, bpm)) * qnPerBeat;
  const barSec = beatSec * beatsPerBar;

  const pos0 = Math.max(0, playheadPosBars - 1);
  const barIndex = Math.floor(pos0);
  const barNumber = barIndex + 1;
  const fracBar = pos0 - barIndex;
  const beatFloat = fracBar * beatsPerBar;
  const beatIndex = Math.floor(beatFloat);
  const beatNumber = beatIndex + 1;
  const fracBeat = beatFloat - beatIndex;
  const tickNumber = Math.floor(fracBeat * TICKS_PER_BEAT);

  const timeSec = pos0 * barSec;
  const mins = Math.floor(timeSec / 60);
  const secs = Math.floor(timeSec % 60);
  const ms = Math.floor((timeSec - Math.floor(timeSec)) * 1000);

  return {
    posString: `${barNumber}.${beatNumber}.${String(tickNumber).padStart(2, "0")}`,
    timeString: `${mins}:${String(secs).padStart(2, "0")}.${String(ms).padStart(3, "0")}`,
  };
}

export default function TransportConsole({
  playheadPosBars,
  isPlaying,
  loopEnabled,
  bpm,
  sigNum,
  sigDen,
  onReturnStart,
  onStop,
  onTogglePlay,
  onRecord,
  onToggleKeyboard,
  keyboardOpen = false,
  recording = false,
  onToggleLoop,
  onJumpEnd,
  onBpmChange,
  onSignatureChange,
  className = "",
  compact = false,
}: Props) {
  const { posString, timeString } = transportStrings(playheadPosBars, bpm, sigNum, sigDen);

  return (
    <div
      className={`w-full ${compact ? "max-w-[720px]" : "max-w-[760px]"} rounded-xl border border-neutral-200/15 dark:border-neutral-800 bg-neutral-950/70 shadow-lg px-2 sm:px-3 py-2 flex flex-col items-center gap-2 ${className}`}
      data-ysong-transport="true"
    >
      <div className="flex items-center justify-center gap-3 sm:gap-6 text-[11px] sm:text-[12px] min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="opacity-55">Pos</span>
          <span className="font-mono font-medium tabular-nums">{posString}</span>
        </div>
        <div className="w-px h-4 bg-neutral-200/15" />
        <div className="flex items-center gap-1.5">
          <span className="opacity-55">Time</span>
          <span className="font-mono font-medium tabular-nums">{timeString}</span>
        </div>
      </div>

      <div className="w-full flex flex-wrap items-center justify-center gap-1.5 sm:gap-2">
        <YSButton className="px-2 py-1 text-sm rounded-md" onClick={onReturnStart} title="Return to beginning">
          &lt;&lt;
        </YSButton>
        <YSButton className="px-2 py-1 text-sm rounded-md" onClick={onStop} title="Stop">
          ■
        </YSButton>
        <YSButton className="px-3 py-1 text-sm rounded-md" onClick={onTogglePlay} title="Play/Pause (Space)">
          {isPlaying ? "❚❚" : "▶"}
        </YSButton>
        <YSButton className={`px-2 py-1 text-sm rounded-md ${recording ? "!bg-rose-400 !text-black opacity-100 shadow-[0_0_12px_rgba(251,113,133,0.45)]" : "opacity-70"}`} onClick={onRecord ?? (() => {})} title={recording ? "Stop MIDI recording" : "Record armed/selected instrument track"}>
          ●
        </YSButton>
        {onToggleKeyboard && (
          <YSButton className={`px-2 py-1 text-sm rounded-md ${keyboardOpen ? "!bg-cyan-200 !text-neutral-950 opacity-100" : "opacity-70"}`} onClick={onToggleKeyboard} title="On-screen piano / computer keyboard">
            ⌨
          </YSButton>
        )}
        <YSButton
          className={`px-2 py-1 text-sm rounded-md ${loopEnabled ? "!bg-neutral-100 dark:!bg-neutral-100 !text-neutral-950 dark:!text-neutral-950 opacity-100" : "!bg-neutral-950 dark:!bg-neutral-950 !text-neutral-50 dark:!text-neutral-50 opacity-70"}`}
          onClick={onToggleLoop}
          title="Loop (L-R)"
        >
          ⟲
        </YSButton>
        <YSButton className="px-2 py-1 text-sm rounded-md" onClick={onJumpEnd} title="Jump to song end">
          &gt;&gt;
        </YSButton>

        <div className="hidden sm:block w-px h-6 bg-neutral-200/15 mx-1" />
        <label className="flex items-center gap-1 text-[10px] sm:text-[11px] opacity-80">
          <span>BPM</span>
          <input
            className="w-[68px] sm:w-[76px] px-2 py-1 rounded-md bg-neutral-950/40 border border-neutral-200/10 dark:border-neutral-800 text-sm"
            type="number"
            min={20}
            max={400}
            step={1}
            value={bpm}
            onChange={(e) => onBpmChange(clamp(Number(e.target.value || 120), 20, 400))}
          />
        </label>
        <label className="flex items-center gap-1 text-[10px] sm:text-[11px] opacity-80">
          <span>Sig</span>
          <select
            className="px-2 py-1 rounded-md bg-neutral-950/40 border border-neutral-200/10 dark:border-neutral-800 text-sm"
            value={`${sigNum}/${sigDen}`}
            onChange={(e) => {
              const [n, d] = e.target.value.split("/").map(Number);
              onSignatureChange(n, d);
            }}
          >
            <option value="4/4">4/4</option>
            <option value="3/4">3/4</option>
            <option value="6/8">6/8</option>
            <option value="5/4">5/4</option>
            <option value="7/8">7/8</option>
          </select>
        </label>
      </div>
    </div>
  );
}
