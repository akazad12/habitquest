import type { Server } from "node:http";
import type { Logger } from "./observability.js";
export function shutdownHandler(
  server: Server,
  disconnect: () => Promise<void>,
  log: Logger,
  exit: (code: number) => void,
  deadlineMs = 10000,
) {
  let draining = false;
  return {
    isDraining: () => draining,
    stop: () => {
      if (draining) return;
      draining = true;
      log({ event: "shutdown_started" });
      const deadline = setTimeout(() => {
        server.closeAllConnections();
        log({ event: "shutdown_timeout" });
        exit(1);
      }, deadlineMs);
      deadline.unref();
      server.close(() => {
        void disconnect()
          .then(() => {
            clearTimeout(deadline);
            log({ event: "shutdown_complete" });
            exit(0);
          })
          .catch(() => {
            clearTimeout(deadline);
            log({ event: "shutdown_failed" });
            exit(1);
          });
      });
      server.closeIdleConnections();
    },
  };
}
