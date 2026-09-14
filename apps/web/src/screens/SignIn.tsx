import { useState, type FormEvent } from "react";
import { useAuth } from "../lib/auth";

export function Splash() {
  return <div className="signin"><div className="signin__card"><img src="/wyre-logo.png" alt="Wyre" className="signin__logo" /><div className="muted">Loading your projects…</div></div></div>;
}

/** Live-backend sign-in (in-house staff accounts). The mock build never shows this. */
export function SignIn() {
  const { login } = useAuth();
  const [u, setU] = useState(""); const [p, setP] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const go = async (e: FormEvent) => { e.preventDefault(); setBusy(true); setErr(""); try { await login(u.trim(), p); } catch (x) { setErr(x instanceof Error ? x.message : "Sign-in failed"); } finally { setBusy(false); } };
  return <div className="signin"><form className="signin__card" onSubmit={go}>
    <img src="/wyre-logo.png" alt="Wyre" className="signin__logo" />
    <h1 className="signin__title">Wyre Tracker</h1><div className="muted sm">Sign in with your Wyre staff account</div>
    <label className="ns-field"><span className="ns-field__label">Username</span><input className="ns-input" autoComplete="username" autoCapitalize="none" value={u} onChange={(e) => setU(e.target.value)} required autoFocus /></label>
    <label className="ns-field"><span className="ns-field__label">Password</span><input className="ns-input" type="password" autoComplete="current-password" value={p} onChange={(e) => setP(e.target.value)} required /></label>
    {err && <div className="note note--danger">{err}</div>}
    <button className="ns-btn ns-btn--primary ns-btn--block ns-btn--lg" disabled={busy || !u || !p}>{busy ? "Signing in…" : "Sign in"}</button>
  </form></div>;
}
