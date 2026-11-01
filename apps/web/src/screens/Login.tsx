import {
  ArrowRight,
  ChefHat,
  ShieldCheck,
  UtensilsCrossed,
} from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import { Badge } from "../components/ui";
export default function Login({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState("admin@tokenex.local"),
    [password, setPassword] = useState(""),
    [otp, setOtp] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [provider, setProvider] = useState("");
  useEffect(() => {
    fetch("/health")
      .then((r) => r.json())
      .then((r) => setProvider(r.provider))
      .catch(() => {});
  }, []);
  return (
    <main className="login">
      <section className="login-story">
        <div className="brand">
          <span className="logo">
            <UtensilsCrossed />
          </span>
          tokenex<span className="dot">.</span>
        </div>
        <Badge tone="light">THE FOOD COURT, CONNECTED</Badge>
        <h1>
          Every cuisine.
          <br />
          One smooth
          <br />
          <em>experience.</em>
        </h1>
        <p>
          From the first tap to the final pickup.
          <br />A calmer way to run your food court.
        </p>
        <div className="login-stats">
          <div>
            <ChefHat />
            <b>KitchQ</b>
            <span>Made for your kitchen</span>
          </div>
          <div>
            <ShieldCheck />
            <b>In control</b>
            <span>Every transaction tracked</span>
          </div>
        </div>
        <small>TOKENEX OPERATING SYSTEM</small>
      </section>
      <section className="login-form">
        <Badge>WELCOME BACK</Badge>
        <h2>Your service starts here.</h2>
        <p>Sign in to your workspace.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await api("/auth/login", {
                email,
                password,
                otp: otp || undefined,
              });
              onLogin();
            } catch (e: any) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </label>
          <label>
            Authenticator code (if enabled)
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              maxLength={6}
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary wide" disabled={busy}>
            {busy ? "Signing in…" : "Enter workspace"}
            <ArrowRight size={18} />
          </button>
        </form>
        <div className="notice">
          <ShieldCheck size={18} />
          <span>
            {provider === "sandbox"
              ? "Sandbox workspace. Digital payments here are simulated."
              : "Your authorized food-court workspace."}
            <br />
            Use the credentials configured during setup.
          </span>
        </div>
      </section>
    </main>
  );
}
