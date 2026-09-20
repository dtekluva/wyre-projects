import { useEffect } from "react";
import { remote } from "./api";

/**
 * Poll the server while something is being worked on elsewhere.
 *
 * Snapshots normally arrive as the response to a command the browser sends. Reading a document happens
 * in the scheduler container, so nothing is being sent while we wait — without this the UI sits on
 * "reading…" forever even though the work finished seconds ago.
 */
export function useWaitFor(active: boolean, everyMs = 3000) {
  useEffect(() => {
    if (!active || !remote) return;
    let stopped = false;
    const tick = () => { if (!stopped) void remote!.refresh().catch(() => undefined); };
    const h = setInterval(tick, everyMs);
    tick();                                    // ask immediately: it may already be done
    return () => { stopped = true; clearInterval(h); };
  }, [active, everyMs]);
}
