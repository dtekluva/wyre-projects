import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { remote } from "../lib/api";
import type { LinkOwner } from "@wyre/api";

const MIN = 10;

/**
 * Both halves of "I have no password yet": an invite link and a reset link. Same screen because the
 * person's job is identical — prove you hold the link, choose a password. The link is single-use, so
 * this never renders twice for the same token.
 */
export function SetPassword({ kind }: { kind: "invite" | "reset" }) {
  const { token = "" } = useParams();
  const [owner, setOwner] = useState<LinkOwner | null>(null);
  const [state, setState] = useState<"checking" | "ready" | "dead" | "done">("checking");
  const [err, setErr] = useState("");
  const [pw, setPw] = useState(""); const [pw2, setPw2] = useState(""); const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    if (!remote) { setState("dead"); setErr("This build has no backend."); return; }
    remote.linkOwner(kind, token)
      .then((o) => { if (live) { setOwner(o); setState("ready"); } })
      .catch((e) => { if (live) { setErr(e instanceof Error ? e.message : "That link is not valid."); setState("dead"); } });
    return () => { live = false; };
  }, [kind, token]);

  const go = async (e: FormEvent) => {
    e.preventDefault(); setErr("");
    if (pw.length < MIN) return setErr(`Password must be at least ${MIN} characters`);
    if (pw !== pw2) return setErr("The two passwords do not match");
    setBusy(true);
    try { await remote!.setPasswordWithToken(kind, token, pw); setState("done"); }
    catch (x) { setErr(x instanceof Error ? x.message : "Could not set that password."); }
    finally { setBusy(false); }
  };

  const title = kind === "invite" ? "Welcome to Wyre Tracker" : "Choose a new password";

  return <div className="signin"><div className="signin__card">
    <img src="/wyre-logo.png" alt="Wyre" className="signin__logo" />
    {state === "checking" && <div className="muted">Checking your link…</div>}

    {state === "dead" && <>
      <h1 className="signin__title">Link not valid</h1>
      <div className="note note--danger">{err}</div>
      <div className="sm muted">Invite links last 7 days, reset links 2 hours, and each one works once.
        {kind === "invite" ? " Ask whoever invited you to send another." : " You can request a new one below."}</div>
      {kind === "reset" && <a className="ns-btn ns-btn--block" href="/forgot">Request a new link</a>}
      <a className="ns-btn ns-btn--ghost ns-btn--block" href="/">Back to sign in</a>
    </>}

    {state === "done" && <>
      <h1 className="signin__title">Password set</h1>
      <div className="note note--success">You can sign in{owner ? ` as ${owner.username}` : ""} now.</div>
      <a className="ns-btn ns-btn--primary ns-btn--block ns-btn--lg" href="/">Sign in</a>
    </>}

    {state === "ready" && <form className="stack" onSubmit={go} style={{ gap: 12 }}>
      <h1 className="signin__title">{title}</h1>
      <div className="muted sm">{owner?.name} · your username is <b>{owner?.username}</b></div>
      <label className="ns-field"><span className="ns-field__label">New password</span>
        <input className="ns-input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required autoFocus />
        <span className="sm muted">At least {MIN} characters. A short phrase you will remember beats a short jumble.</span></label>
      <label className="ns-field"><span className="ns-field__label">Repeat it</span>
        <input className="ns-input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required /></label>
      {err && <div className="note note--danger">{err}</div>}
      <button className="ns-btn ns-btn--primary ns-btn--block ns-btn--lg" disabled={busy || !pw || !pw2}>{busy ? "Saving…" : "Set password"}</button>
    </form>}
  </div></div>;
}

/** Ask for a reset link. Always reports the same thing, whether or not the address has an account. */
export function Forgot() {
  const [email, setEmail] = useState(""); const [sent, setSent] = useState(false); const [busy, setBusy] = useState(false);
  const go = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true);
    try { await remote?.requestPasswordReset(email.trim()); } finally { setBusy(false); setSent(true); }
  };
  return <div className="signin"><div className="signin__card">
    <img src="/wyre-logo.png" alt="Wyre" className="signin__logo" />
    {sent ? <>
      <h1 className="signin__title">Check your email</h1>
      <div className="note note--success">If {email.trim()} has an account, a reset link is on its way. It lasts 2 hours.</div>
      <div className="sm muted">Nothing arrived? Check spam, or ask a director to resend your invite.</div>
      <a className="ns-btn ns-btn--block" href="/">Back to sign in</a>
    </> : <form className="stack" onSubmit={go} style={{ gap: 12 }}>
      <h1 className="signin__title">Forgot your password</h1>
      <div className="muted sm">We'll email you a link to choose a new one.</div>
      <label className="ns-field"><span className="ns-field__label">Work email</span>
        <input className="ns-input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></label>
      <button className="ns-btn ns-btn--primary ns-btn--block ns-btn--lg" disabled={busy || !email}>{busy ? "Sending…" : "Send reset link"}</button>
      <a className="ns-btn ns-btn--ghost ns-btn--block" href="/">Back to sign in</a>
    </form>}
  </div></div>;
}
