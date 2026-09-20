import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * A blank page is the worst failure this app can show: no message, no cause, nothing to report. One
 * unhandled render error used to do exactly that. This keeps the shell, says what broke, and leaves the
 * detail on screen so it can be copied into a bug report instead of being retyped from memory.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("Unhandled UI error", error, info); }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return <div className="signin"><div className="signin__card stack" style={{ gap: 12 }}>
      <img src="/wyre-logo.png" alt="Wyre" className="signin__logo" />
      <h1 className="signin__title">Something broke on this screen</h1>
      <div className="muted sm">Your data is safe — this is the page failing to draw, not a lost change.</div>
      <pre className="sm" style={{ whiteSpace: "pre-wrap", textAlign: "left", maxHeight: 200, overflow: "auto" }}>{error.message}</pre>
      <button className="ns-btn ns-btn--primary ns-btn--block" onClick={() => { this.setState({ error: null }); location.reload(); }}>Reload</button>
      <a className="ns-btn ns-btn--ghost ns-btn--block" href="/">Back to the portfolio</a>
    </div></div>;
  }
}
