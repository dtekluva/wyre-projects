import { useEffect, useState } from "react";
export function useGeo() {
  const [state, set] = useState<{ status: "locating" | "ok" | "denied" | "unavailable"; lat?: number; lng?: number }>({ status: "locating" });
  useEffect(() => {
    if (!("geolocation" in navigator)) { set({ status: "unavailable" }); return; }
    const id = navigator.geolocation.watchPosition((p) => set({ status: "ok", lat: p.coords.latitude, lng: p.coords.longitude }), () => set((s) => (s.status === "ok" ? s : { status: "denied" })), { enableHighAccuracy: true, maximumAge: 30000, timeout: 15000 });
    return () => navigator.geolocation.clearWatch(id);
  }, []);
  return state;
}
