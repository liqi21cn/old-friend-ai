/**
 * Tiny retry helper for LLM + network calls.
 *
 * Retries on ANY throw — including parser failures we throw ourselves inside
 * the wrapped fn (e.g. "model returned non-array"). Exponential backoff with
 * an optional onRetry callback for logging / progress updates.
 */
export interface RetryOpts {
  attempts?: number;
  baseDelayMs?: number;
  onRetry?: (attempt: number, err: Error) => void | Promise<void>;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOpts = {},
): Promise<T> {
  const max = opts.attempts ?? 3;
  const base = opts.baseDelayMs ?? 1000;
  let lastErr: unknown;
  for (let i = 0; i < max; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < max - 1) {
        // Exponential backoff with jitter: 1s, 2s, 4s ± 30%
        const wait =
          base * Math.pow(2, i) * (0.85 + Math.random() * 0.3);
        await new Promise((r) => setTimeout(r, wait));
        await opts.onRetry?.(i + 1, e as Error);
      }
    }
  }
  throw lastErr;
}
