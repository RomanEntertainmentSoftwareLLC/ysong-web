// Coalesce transient visual updates and back off while the native Bridge is offline.
export function createBridgeBackoff<T>(send: (value: T) => Promise<unknown>, now = Date.now) {
  let pending = false, nextAttempt = 0, delay = 1000;
  return async (value: T): Promise<void> => {
    if (pending || now() < nextAttempt) return;
    pending = true;
    try { await send(value); delay = 1000; nextAttempt = 0; }
    catch { delay = Math.min(60000, delay * 2); nextAttempt = now() + delay; }
    finally { pending = false; }
  };
}
