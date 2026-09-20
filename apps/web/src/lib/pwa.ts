/**
 * The service worker exists for the field PWA: a tech on a roof needs the app to open with no signal.
 * The desktop app needs no such thing, and paying for it means every deploy can leave somebody on a
 * cached bundle wondering why a fix did not arrive — which happened repeatedly (2026-09-20).
 *
 * So it registers only under /field, and actively unregisters itself anywhere else, to clear the ones
 * already installed on desktop browsers from when it registered everywhere.
 */
export function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  const force = new URLSearchParams(location.search).has("sw");
  const wantsIt = location.pathname.startsWith("/field") || force;

  if (!wantsIt) {
    // Clean up after the version that registered app-wide. Without this, a desktop browser keeps
    // serving the shell it cached months ago and no amount of reloading helps.
    navigator.serviceWorker.getRegistrations()
      .then((rs) => rs.forEach((r) => { if (r.active?.scriptURL.endsWith("/sw.js")) void r.unregister(); }))
      .catch(() => undefined);
    return;
  }
  if (!import.meta.env.PROD && !force) return;
  window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined); });
}

/** Which build is running. Printed once at boot so "what version are you on?" has an answer. */
export function stampBuild() {
  const v = (import.meta.env.VITE_BUILD ?? "dev") as string;
  // eslint-disable-next-line no-console
  console.info(`Wyre Tracker build ${v}`);
  document.documentElement.dataset.build = v;
}
