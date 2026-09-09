/** Registers the service worker in production (or when ?sw is present in dev for testing). */
export function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  const force = new URLSearchParams(location.search).has("sw");
  if (!import.meta.env.PROD && !force) return;
  window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined); });
}
