import { DEFAULT_VISUAL_SCENE, normalizeVisualScene, type VisualSceneState } from "./visualsScene.ts";

export const VISUAL_SCENE_JOURNAL_KEY = "ysong.visuals.scene.journal.v1";
const MAX_REVISIONS = 5;
const MAX_BYTES = 2_000_000;
const byteLength = (value: string) => new TextEncoder().encode(value).length;

type Revision = { updatedAt: number; scene: VisualSceneState };

export function readVisualSceneJournal(raw: string | null): Revision[] {
	if (!raw || byteLength(raw) > MAX_BYTES) return [];
	try {
		const value: unknown = JSON.parse(raw);
		if (!value || typeof value !== "object" || (value as { v?: unknown }).v !== 1 || !Array.isArray((value as { revisions?: unknown }).revisions)) return [];
		const revisions = (value as { revisions: unknown[] }).revisions;
		if (revisions.length > MAX_REVISIONS) return [];
		return revisions.map(entry => {
			const item = entry as Revision;
			if (!item || !Number.isFinite(item.updatedAt) || !item.scene || !Array.isArray(item.scene.layers) ||
				typeof item.scene.project?.id !== "string" || item.scene.updatedAt !== item.updatedAt) throw new Error("Invalid revision");
			return { updatedAt: item.updatedAt, scene: normalizeVisualScene(item.scene) };
		}).sort((a,b) => a.updatedAt - b.updatedAt);
	} catch { return []; }
}

export function appendVisualSceneJournal(raw: string | null, scene: VisualSceneState): string | null {
	if (!Number.isFinite(scene.updatedAt) || !scene.project?.id || !Array.isArray(scene.layers)) return null;
	const prior = readVisualSceneJournal(raw).filter(item => item.scene.project.id === scene.project.id);
	// Persist the scene schema only; editor and renderer instances are rebuilt on restore.
	const logical = Object.fromEntries(Object.keys(DEFAULT_VISUAL_SCENE).map(key => [key, scene[key as keyof VisualSceneState]])) as VisualSceneState;
	const revisions = [...prior.filter(item => item.updatedAt < scene.updatedAt), { updatedAt: scene.updatedAt, scene: logical }].slice(-MAX_REVISIONS);
	while (revisions.length) {
		const encoded = JSON.stringify({ v: 1, revisions });
		if (byteLength(encoded) <= MAX_BYTES) return encoded;
		if (revisions.length === 1) return null;
		revisions.shift();
	}
	return null;
}

export function newerVisualRevision(raw: string | null, saved: VisualSceneState | null): VisualSceneState | null {
	const latest = readVisualSceneJournal(raw).at(-1);
	return latest && (!saved || latest.scene.project.id === saved.project.id) && latest.updatedAt > (saved?.updatedAt ?? 0)
		? latest.scene : null;
}
