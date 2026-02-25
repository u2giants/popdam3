/**
 * Illustrator Circuit Breaker
 *
 * After N consecutive Illustrator failures the breaker trips,
 * preventing further Illustrator invocations for a cooldown window.
 * PSD / PDF-compatible AI files continue rendering via Sharp/Ghostscript.
 */

import { config } from "./config";
import { logger } from "./logger";

let consecutiveFailures = 0;
let cooldownUntil: number | null = null;

/** Record a successful Illustrator invocation — resets the breaker. */
export function recordIllustratorSuccess(): void {
  if (consecutiveFailures > 0) {
    logger.info("Illustrator circuit breaker reset (success after failures)", {
      previousFailures: consecutiveFailures,
    });
  }
  consecutiveFailures = 0;
  cooldownUntil = null;
}

/** Record a failed Illustrator invocation — may trip the breaker. */
export function recordIllustratorFailure(): void {
  consecutiveFailures++;
  logger.warn("Illustrator failure recorded", {
    consecutiveFailures,
    limit: config.illustratorFailureLimit,
  });

  if (consecutiveFailures >= config.illustratorFailureLimit && !cooldownUntil) {
    cooldownUntil = Date.now() + config.illustratorCooldownMs;
    logger.error("Illustrator circuit breaker TRIPPED — cooldown active", {
      consecutiveFailures,
      cooldownUntilISO: new Date(cooldownUntil).toISOString(),
      cooldownMs: config.illustratorCooldownMs,
    });
  }
}

/** Is Illustrator currently available (breaker closed)? */
export function isIllustratorAvailable(): boolean {
  if (cooldownUntil === null) return true;

  if (Date.now() >= cooldownUntil) {
    // Cooldown expired — allow a probe attempt
    logger.info("Illustrator cooldown expired — allowing probe attempt");
    cooldownUntil = null;
    // Keep consecutiveFailures so next failure re-trips immediately
    return true;
  }

  return false;
}

/** Structured status for heartbeat reporting. */
export interface CircuitBreakerStatus {
  illustratorCircuitBreaker: "closed" | "open";
  consecutiveFailures: number;
  cooldownUntil: string | null;
}

export function getCircuitBreakerStatus(): CircuitBreakerStatus {
  return {
    illustratorCircuitBreaker: cooldownUntil && Date.now() < cooldownUntil ? "open" : "closed",
    consecutiveFailures,
    cooldownUntil: cooldownUntil ? new Date(cooldownUntil).toISOString() : null,
  };
}
