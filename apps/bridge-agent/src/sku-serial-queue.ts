/** Serializes only files that resolve to the same SKU during one scan. */
export class SkuSerialQueue {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(key: string | null, task: () => Promise<T>): Promise<T> {
    if (!key) return task();
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => current);
    this.tails.set(key, tail);
    await previous;
    try {
      return await task();
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}

export function skuFromRelativePath(relativePath: string): string | null {
  const parts = relativePath.split("/");
  for (const folder of parts.slice(0, -1)) {
    if (/^[A-Za-z0-9]+$/.test(folder) && folder.length >= 7 && /[A-Za-z]/.test(folder) && /\d/.test(folder)) return folder;
  }
  return null;
}
