import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type Kind = "info" | "error" | "success";
type Notify = (msg: string, kind?: Kind) => void;
const Ctx = createContext<Notify>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ msg: string; kind: Kind } | null>(null);
  const notify = useCallback<Notify>((msg, kind = "info") => { setT({ msg, kind }); window.setTimeout(() => setT(null), 3400); }, []);
  return <Ctx.Provider value={notify}>{children}{t && <div className={`toast toast--${t.kind}`} role="status">{t.msg}</div>}</Ctx.Provider>;
}
export const useToast = () => useContext(Ctx);
/** Run a mutation; API errors (forbidden / invalid / conflict) surface as toasts instead of crashes. */
export function useSafe() {
  const notify = useToast();
  return (fn: () => void, ok?: string) => {
    try { fn(); if (ok) notify(ok, "success"); return true; }
    catch (e) { notify(e instanceof Error ? e.message : String(e), "error"); return false; }
  };
}
