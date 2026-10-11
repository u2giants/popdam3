/**
 * Heartbeat command dispatch table.
 *
 * Each handler inspects the heartbeat `commands` payload and acts only when
 * its own trigger (and guards) are present. Handlers run sequentially in table
 * order, exactly as the original inline `if` chain did: a synchronous handler
 * runs without yielding to the event loop, and only a handler that returns a
 * promise (e.g. remote re-pairing) is awaited before the next one runs.
 */
export interface CommandHandler<C> {
  /** Stable name — the primary command key the handler reacts to. */
  name: string;
  run: (commands: C) => void | Promise<void>;
}

export async function dispatchCommands<C>(commands: C, handlers: readonly CommandHandler<C>[]): Promise<void> {
  for (const handler of handlers) {
    const result = handler.run(commands);
    if (result instanceof Promise) await result;
  }
}
