import { Spinner } from "./Spinner";

export function ConnectingScreen({ error }: { error: string | null }) {
  return (
    <main className="auth-screen">
      <section className="auth-card" aria-live="polite">
        <div className="brand-mark">A</div>
        <span className="eyebrow">Agent Launchpad</span>
        <h1>Connecting to the control plane</h1>
        {error ? <div className="error-banner" role="alert">{error}</div> : <Spinner />}
      </section>
    </main>
  );
}

export function AuthGate({
  error,
  busy,
  authInput,
  onAuthInputChange,
  onSubmit,
}: {
  error: string | null;
  busy: boolean;
  authInput: string;
  onAuthInputChange: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
}) {
  return (
    <main className="auth-screen">
      <form className="auth-card" onSubmit={onSubmit}>
        <div className="brand-mark">A</div>
        <span className="eyebrow">Agent Launchpad</span>
        <h1>Enter the access token</h1>
        <p>This shared demo token is configured by the platform operator.</p>
        {error && <div className="error-banner" role="alert">{error}</div>}
        <label>
          Access token
          <input
            autoFocus
            type="password"
            value={authInput}
            onChange={(event) => onAuthInputChange(event.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        <button className="button button-primary" disabled={busy || !authInput.trim()}>
          {busy ? <Spinner /> : "Open Launchpad"}
        </button>
      </form>
    </main>
  );
}
