// Freeze audio is local to this browser. Project state keeps only the artifact id;
// a missing IndexedDB entry must never hide the editable MIDI source.
const DB_NAME = "ysong-daw-freeze";
const STORE = "artifacts";

function openDatabase(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, 1);
		request.onupgradeneeded = () => request.result.createObjectStore(STORE);
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

export async function saveFreezeArtifact(id: string, wav: Blob): Promise<void> {
	const db = await openDatabase();
	try {
		await new Promise<void>((resolve, reject) => {
			const transaction = db.transaction(STORE, "readwrite");
			transaction.objectStore(STORE).put(wav, id);
			transaction.oncomplete = () => resolve();
			transaction.onerror = () => reject(transaction.error);
			transaction.onabort = () => reject(transaction.error);
		});
	} finally { db.close(); }
}

export async function loadFreezeArtifact(id: string): Promise<Blob | null> {
	const db = await openDatabase();
	try {
		return await new Promise<Blob | null>((resolve, reject) => {
			const request = db.transaction(STORE).objectStore(STORE).get(id);
			request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : null);
			request.onerror = () => reject(request.error);
		});
	} finally { db.close(); }
}
