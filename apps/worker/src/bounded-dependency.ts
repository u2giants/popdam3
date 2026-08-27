export const CONFIG_READ_TIMEOUT_MS = 10_000;

/**
 * Bound remote configuration reads so one hung PostgREST request cannot stop
 * the single Railway operation loop indefinitely.
 */
export function withDependencyTimeout<T>(
  label: string,
  work: PromiseLike<T>,
  timeoutMs = CONFIG_READ_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    timer.unref?.();
    Promise.resolve(work).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
