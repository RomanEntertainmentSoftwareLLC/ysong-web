import type { CreativeStudioProject } from "./creativeStudioProject";

export const STUDIO_HISTORY_LIMIT = 30;
export const STUDIO_HISTORY_BYTES = 4 * 1024 * 1024;

type Entry = { project: CreativeStudioProject; bytes: number };
export type StudioHistory = {
  present: CreativeStudioProject;
  past: Entry[];
  future: Entry[];
  group?: string;
  groupAt?: number;
};

// Projects are immutable edit results. Count UTF-16 bytes conservatively for retained snapshots.
const entry = (project: CreativeStudioProject): Entry => ({ project, bytes: JSON.stringify(project).length * 2 });
const bounded = (past: Entry[], future: Entry[] = []) => {
  const keptPast = [...past];
  const keptFuture = [...future];
  let bytes = [...keptPast, ...keptFuture].reduce((sum, item) => sum + item.bytes, 0);
  while (keptPast.length + keptFuture.length > STUDIO_HISTORY_LIMIT || bytes > STUDIO_HISTORY_BYTES) {
    // Keep the next undo or redo step ahead of older snapshots.
    const removed = keptPast.length ? keptPast.shift()! : keptFuture.shift()!;
    bytes -= removed.bytes;
  }
  return { past: keptPast, future: keptFuture };
};

export const createStudioHistory = (present: CreativeStudioProject): StudioHistory => ({ present, past: [], future: [] });

export function editStudioHistory(history: StudioHistory, next: CreativeStudioProject, group?: string, at = Date.now()): StudioHistory {
  if (next === history.present) return history;
  const grouped = !!group && group === history.group && at - (history.groupAt ?? 0) < 1000 && history.past.length > 0;
  return {
    present: next,
    past: grouped ? history.past : bounded([...history.past, entry(history.present)]).past,
    future: [],
    group,
    groupAt: at,
  };
}

export function undoStudioHistory(history: StudioHistory): StudioHistory {
  if (!history.past.length) return history;
  const previous = history.past[history.past.length - 1];
  return { present: previous.project, ...bounded(history.past.slice(0, -1), [...history.future, entry(history.present)]) };
}

export function redoStudioHistory(history: StudioHistory): StudioHistory {
  if (!history.future.length) return history;
  const next = history.future[history.future.length - 1];
  return { present: next.project, ...bounded([...history.past, entry(history.present)], history.future.slice(0, -1)) };
}
