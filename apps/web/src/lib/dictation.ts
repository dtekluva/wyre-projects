/** Browser speech-to-text. The device transcribes; Claude only gives the words structure. */
type SR = { start(): void; stop(): void; continuous: boolean; interimResults: boolean; lang: string;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null };

export function speechSupported(): boolean {
  return typeof window !== "undefined" && !!((window as never as Record<string, unknown>).SpeechRecognition || (window as never as Record<string, unknown>).webkitSpeechRecognition);
}

/**
 * Starts listening. `onText` receives the transcript so far (final + whatever is still being said),
 * so the speaker can watch their own words and catch a mangled serial as it happens.
 */
export function listen(onText: (text: string, final: boolean) => void, onError: (msg: string) => void): () => void {
  const W = window as never as Record<string, new () => SR>;
  const Ctor = W.SpeechRecognition || W.webkitSpeechRecognition;
  if (!Ctor) { onError("This browser cannot transcribe speech — use Chrome, Edge or Safari, or upload the note instead."); return () => undefined; }
  const r = new Ctor();
  r.continuous = true; r.interimResults = true; r.lang = "en-NG";
  let settled = "";
  r.onresult = (e) => {
    let live = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const alt = e.results[i][0]; if (!alt) continue;
      if (e.results[i].isFinal) settled += alt.transcript + " "; else live += alt.transcript;
    }
    onText((settled + live).trim(), false);
  };
  r.onerror = (e) => onError(e.error === "not-allowed"
    ? "Microphone blocked — allow it in the address bar, or upload the delivery note instead."
    : e.error === "no-speech" ? "Didn't catch anything — try again closer to the microphone."
    : `Could not transcribe (${e.error})`);
  r.onend = () => onText(settled.trim(), true);
  r.start();
  return () => r.stop();
}
