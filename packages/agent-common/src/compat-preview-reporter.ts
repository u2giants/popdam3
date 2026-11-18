/**
 * Compat audit preview reporter — shared by bridge-agent and windows-agent.
 *
 * Sends each flagged asset to the server exactly once. After every batch the
 * reporter posts only the flags found since the last successful write, never
 * the accumulated list. A failed write keeps its flags pending so the next
 * write (or the final completion) delivers them; the server merges by asset id,
 * so a retried write cannot create duplicates.
 */

export interface CompatPreviewFlag {
  id: string;
  thumbnail_url: string;
  relative_path: string;
}

export interface CompatPreviewReporterOptions {
  /** Live progress write, called after each batch with only the newly flagged assets. */
  progress: (scanned: number, flagged: CompatPreviewFlag[]) => Promise<void>;
  /** Final write. Carries any flags not yet delivered; its errors propagate to the caller. */
  complete: (scanned: number, flagged: CompatPreviewFlag[], error?: string) => Promise<void>;
  /** Called when a progress write fails, so the failure is visible in logs. */
  onProgressError: (error: unknown, scanned: number) => void;
}

export class CompatPreviewReporter {
  private pending: CompatPreviewFlag[] = [];

  constructor(private readonly opts: CompatPreviewReporterOptions) {}

  /** Records one flagged asset for the next write. */
  record(flag: CompatPreviewFlag): void {
    this.pending.push(flag);
  }

  /** Flags waiting for a successful write. */
  get undelivered(): number {
    return this.pending.length;
  }

  /** Posts progress after a batch. Never throws; a failed write keeps its flags pending. */
  async reportProgress(scanned: number): Promise<void> {
    const batch = this.pending;
    try {
      await this.opts.progress(scanned, batch);
      this.pending = this.pending.slice(batch.length);
    } catch (error) {
      this.opts.onProgressError(error, scanned);
    }
  }

  /** Posts the final result with any undelivered flags. Throws if the write fails. */
  async finish(scanned: number, error?: string): Promise<void> {
    await this.opts.complete(scanned, this.pending, error);
    this.pending = [];
  }
}
