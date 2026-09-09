import { useEffect, useState } from "react";
export function useMediaQuery(query: string) {
  const get = () => typeof window !== "undefined" && window.matchMedia(query).matches;
  const [m, setM] = useState(get);
  useEffect(() => { const mq = window.matchMedia(query); const h = () => setM(mq.matches); h(); mq.addEventListener("change", h); return () => mq.removeEventListener("change", h); }, [query]);
  return m;
}
export const useIsMobile = () => useMediaQuery("(max-width: 860px)");
