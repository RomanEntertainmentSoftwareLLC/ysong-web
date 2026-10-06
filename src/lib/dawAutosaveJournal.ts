// A journal is tied to the exact explicit save it extends. A later save wins.
export type Journal<T extends object> = {
	v: 1;
	base: string | null;
	name: string;
	entries: Partial<T>[];
};

export const journalKey = (id: string) => `ysong:daw:journal:${id}`;
export const MAX_JOURNAL_ENTRIES = 24;
const baseId = (text: string | null): string | null => {
	if (text === null) return null;
	let hash = 2166136261;
	for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
	return `${text.length}:${hash >>> 0}`;
};

export function recoverJournal<T extends object>(
	base: T | null, baseText: string | null, raw: string | null,
): { state: T; name: string } | null {
	if (!raw) return null;
	try {
		const journal = JSON.parse(raw) as Journal<T>;
		if (journal.v !== 1 || journal.base !== baseId(baseText) || typeof journal.name !== "string" ||
			!Array.isArray(journal.entries) || journal.entries.length < 1 || journal.entries.length > MAX_JOURNAL_ENTRIES) return null;
		let state = { ...base } as T;
		for (const entry of journal.entries) {
			if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
			state = { ...state, ...entry };
		}
		return { state, name: journal.name };
	} catch { return null; }
}

export function appendJournal<T extends object>(
	previous: string | null, base: T | null, baseText: string | null, state: T, name: string,
): string {
	let journal: Journal<T> | null = null;
	try {
		const parsed = previous ? JSON.parse(previous) as Journal<T> : null;
		if (parsed?.v === 1 && parsed.base === baseId(baseText) && Array.isArray(parsed.entries) &&
			parsed.entries.length <= MAX_JOURNAL_ENTRIES) journal = parsed;
	} catch { /* Start a fresh journal. */ }
	const recovered = recoverJournal(base, baseText, journal ? JSON.stringify(journal) : null);
	const prior = recovered?.state ?? base;
	const patch = Object.fromEntries(Object.entries(state).filter(([key, value]) =>
		JSON.stringify(value) !== JSON.stringify((prior as Record<string, unknown> | null)?.[key]))) as Partial<T>;
	const entries = [...(journal?.entries ?? []), patch];
	// Bound both entry count and accumulated size by compacting to one snapshot.
	const compact = entries.length > MAX_JOURNAL_ENTRIES || JSON.stringify(entries).length > 1_000_000;
	const result = JSON.stringify({ v: 1, base: baseId(baseText), name, entries: compact ? [state] : entries } satisfies Journal<T>);
	if (result.length > 2_000_000) throw new Error("Project autosave exceeds the local journal limit. Save locally to keep these edits.");
	return result;
}
