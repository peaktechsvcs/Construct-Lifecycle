import { logger } from "../lib/logger";
import { reconcileProvisioningRecoverySweep } from "../routes/platform-provisioning";

const DEFAULT_RECOVERY_INTERVAL_MS = 5_000;

let activeStop: (() => void) | undefined;

/**
 * Run recovery reconciliation in the server process, independently of
 * browser polling. The timer is unref'd so it cannot keep a graceful process
 * from exiting.
 */
export function startProvisioningRecoveryWorker(
  intervalMs = DEFAULT_RECOVERY_INTERVAL_MS,
): () => void {
  if (activeStop) return activeStop;

  let stopped = false;
  let running = false;
  const run = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await reconcileProvisioningRecoverySweep();
    } catch {
      logger.warn("Provisioning recovery sweep failed");
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void run();
  }, intervalMs);
  timer.unref();

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    if (activeStop === stop) activeStop = undefined;
  };
  activeStop = stop;
  void run();
  return stop;
}

export function stopProvisioningRecoveryWorker(): void {
  activeStop?.();
}