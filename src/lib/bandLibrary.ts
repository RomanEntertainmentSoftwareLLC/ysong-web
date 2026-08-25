export type BandProfile = {
  id: string;
  name: string;
  genre: string;
  bio: string;
  members: string;
  symbol: string;
  primary: string;
  accent: string;
  image?: Blob | null;
  imageName?: string;
  createdAt: number;
  updatedAt: number;
};

const DB_NAME = "ysong-creative-library";
const DB_VERSION = 1;
const STORE = "bands";
const ACTIVE_KEY = "ysong:band-active-id";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function getActiveBandId() {
  try { return localStorage.getItem(ACTIVE_KEY); } catch { return null; }
}

export function setActiveBandId(id: string | null) {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {}
}

export async function listBandProfiles(): Promise<BandProfile[]> {
  if (!("indexedDB" in window)) return [];
  const db = await openDb();
  try {
    const items = await new Promise<BandProfile[]>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result as BandProfile[] : []);
      req.onerror = () => reject(req.error);
    });
    return items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  } finally { db.close(); }
}

export async function getBandProfile(id: string): Promise<BandProfile | null> {
  if (!("indexedDB" in window) || !id) return null;
  const db = await openDb();
  try {
    return await new Promise<BandProfile | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => resolve((req.result as BandProfile | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } finally { db.close(); }
}

export async function getActiveBandProfile(): Promise<BandProfile | null> {
  const id = getActiveBandId();
  if (id) {
    const found = await getBandProfile(id);
    if (found) return found;
  }
  const list = await listBandProfiles();
  return list[0] ?? null;
}

export async function saveBandProfile(profile: Omit<BandProfile, "createdAt" | "updatedAt"> & Partial<Pick<BandProfile, "createdAt" | "updatedAt">>): Promise<BandProfile> {
  if (!("indexedDB" in window)) throw new Error("IndexedDB is unavailable in this browser.");
  const now = Date.now();
  const existing = await getBandProfile(profile.id).catch(() => null);
  const next: BandProfile = {
    ...profile,
    createdAt: existing?.createdAt ?? profile.createdAt ?? now,
    updatedAt: now,
  } as BandProfile;
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(next);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
  setActiveBandId(next.id);
  window.dispatchEvent(new CustomEvent("ysong:bands-changed", { detail: { id: next.id } }));
  return next;
}

export async function deleteBandProfile(id: string): Promise<void> {
  if (!("indexedDB" in window)) return;
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
  if (getActiveBandId() === id) setActiveBandId(null);
  window.dispatchEvent(new CustomEvent("ysong:bands-changed", { detail: { id } }));
}

export async function duplicateBandProfile(id: string): Promise<BandProfile | null> {
  const source = await getBandProfile(id);
  if (!source) return null;
  return saveBandProfile({
    ...source,
    id: crypto.randomUUID(),
    name: `${source.name || "Untitled Band"} Copy`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
}
