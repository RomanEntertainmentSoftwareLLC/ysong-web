import { BAND_STORE, openCreativeLibraryDb, SINGER_STORE } from "./creativeLibraryDb";

export type SingerCharacter = {
  id: string;
  displayName: string;
  avatar?: Blob | null;
  avatarName?: string;
  avatarRef: string;
  voiceDescription: string;
  vocalRange: string;
  vocalStyle: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
};

export type SingerIdentity = Omit<SingerCharacter, "avatar" | "avatarName" | "createdAt" | "updatedAt">;

export function singerIdentity(singer: SingerCharacter): SingerIdentity {
  return {
    id: singer.id,
    displayName: singer.displayName,
    avatarRef: singer.avatarRef || `local-singer:${singer.id}`,
    voiceDescription: singer.voiceDescription,
    vocalRange: singer.vocalRange,
    vocalStyle: singer.vocalStyle,
    tags: singer.tags || [],
  };
}

export async function listSingerCharacters(): Promise<SingerCharacter[]> {
  if (!("indexedDB" in window)) return [];
  const db = await openCreativeLibraryDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(SINGER_STORE, "readonly").objectStore(SINGER_STORE).getAll();
      request.onsuccess = () => resolve((request.result as SingerCharacter[]).sort((a, b) => b.updatedAt - a.updatedAt));
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

export async function saveSingerCharacter(input: Omit<SingerCharacter, "createdAt" | "updatedAt" | "avatarRef"> & Partial<Pick<SingerCharacter, "createdAt" | "avatarRef">>): Promise<SingerCharacter> {
  if (!("indexedDB" in window)) throw new Error("IndexedDB is unavailable in this browser.");
  const db = await openCreativeLibraryDb();
  try {
    const existing = await new Promise<SingerCharacter | undefined>((resolve, reject) => {
      const request = db.transaction(SINGER_STORE, "readonly").objectStore(SINGER_STORE).get(input.id);
      request.onsuccess = () => resolve(request.result as SingerCharacter | undefined);
      request.onerror = () => reject(request.error);
    });
    const now = Date.now();
    const singer: SingerCharacter = {
      ...input,
      avatarRef: input.avatarRef || existing?.avatarRef || `local-singer:${input.id}`,
      tags: input.tags || [],
      createdAt: existing?.createdAt ?? input.createdAt ?? now,
      updatedAt: now,
    };
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(SINGER_STORE, "readwrite");
      transaction.objectStore(SINGER_STORE).put(singer);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    window.dispatchEvent(new CustomEvent("ysong:singers-changed", { detail: { id: singer.id } }));
    return singer;
  } finally { db.close(); }
}

export async function deleteSingerCharacter(id: string): Promise<void> {
  if (!("indexedDB" in window)) return;
  const db = await openCreativeLibraryDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([SINGER_STORE, BAND_STORE], "readwrite");
      transaction.objectStore(SINGER_STORE).delete(id);
      const bands = transaction.objectStore(BAND_STORE);
      const request = bands.getAll();
      request.onsuccess = () => {
        for (const band of request.result as Array<{ id: string; singerIds?: string[] }>) {
          if (band.singerIds?.includes(id)) bands.put({ ...band, singerIds: band.singerIds.filter((singerId) => singerId !== id) });
        }
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
  window.dispatchEvent(new CustomEvent("ysong:singers-changed", { detail: { id } }));
}
