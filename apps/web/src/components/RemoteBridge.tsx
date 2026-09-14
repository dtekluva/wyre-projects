import { useEffect, useState } from "react";
import { remote } from "../lib/api";
import { useToast } from "../lib/toast";

/** Live mode only: surfaces server rejections as toasts and shows a small "syncing" pill while commands are in flight. */
export function RemoteBridge() {
  const toast = useToast(); const [pending, setPending] = useState(0);
  useEffect(() => {
    if (!remote) return;
    const a = remote.onError((e) => toast(`${e.message}`, "error"));
    const b = remote.onSync(setPending);
    return () => { a(); b(); };
  }, [toast]);
  if (!remote || !pending) return null;
  return <div className="syncpill" role="status">Saving… {pending > 1 ? `(${pending})` : ""}</div>;
}
