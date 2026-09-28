const DB_NAME = "ysong-creative-library";
const DB_VERSION = 2;

export const BAND_STORE = "bands";
export const SINGER_STORE = "singers";

export function openCreativeLibraryDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(BAND_STORE)) db.createObjectStore(BAND_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(SINGER_STORE)) db.createObjectStore(SINGER_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
