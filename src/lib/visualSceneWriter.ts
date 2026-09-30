/** Serialize Bridge writes so a completed older request cannot replace a newer scene. */
export function createVisualSceneWriter<T>(write: (scene: T) => Promise<unknown>) {
	let pending: T | undefined;
	let running = false;
	const flush = async () => {
		if (running) return;
		running = true;
		try {
			while (pending !== undefined) {
				const scene = pending;
				pending = undefined;
				try { await write(scene); } catch { /* a newer scene can still be persisted */ }
			}
		} finally {
			running = false;
		}
	};
	return (scene: T) => {
		pending = scene;
		void flush();
	};
}
