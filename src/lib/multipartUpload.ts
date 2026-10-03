export type UploadedAsset = { filename: string; size: number; contentType: string; objectKey: string };
export async function uploadAssetInParts(file: File, base: string, authHeaders: Record<string, string>): Promise<UploadedAsset | null> {
  const call = async (path: string, init: RequestInit) => {
    const response = await fetch(`${base}/api/uploads/multipart${path}`, { credentials: 'include', ...init });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 501 && result.error === 'multipart_unavailable') return null;
      throw new Error(result.message || result.error || `Upload failed (HTTP ${response.status}).`);
    }
    return result;
  };
  const started = await call('', { method: 'POST', headers: { ...authHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: file.name, size: file.size, contentType: file.type || 'application/octet-stream' }) });
  if (!started) return null; // Local disk deployments retain their existing upload route.
  if (!started.session || !Number.isSafeInteger(started.partBytes) || started.partBytes <= 0 || started.partBytes > 16 * 1024 * 1024) throw new Error('Invalid upload session response.');
  const headers = { ...authHeaders, 'X-YSong-Upload-Session': started.session };
  for (let offset = 0, number = 1; offset < file.size; offset += started.partBytes, number++) {
    await call(`/parts/${number}`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body: file.slice(offset, offset + started.partBytes) });
  }
  return await call('/complete', { method: 'POST', headers }) as UploadedAsset;
}
