/**
 * Abortable sleep used by the WeChat monitor loop for backoff, retry and
 * pause delays.
 */

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    // A signal that is already aborted never fires again: without this check
    // the delay would run to its full length and the monitor could not stop.
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    const timer = setTimeout(() => {
      // The monitor retries every few seconds while WeChat is unavailable, and
      // an abort listener left behind per completed sleep piles up for the
      // lifetime of the signal.
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
