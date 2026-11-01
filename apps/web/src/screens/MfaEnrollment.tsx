import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { ShieldCheck } from "lucide-react";
import { api } from "../api";
export default function MfaEnrollment({
  onComplete,
}: {
  onComplete: () => void;
}) {
  const [enrollment, setEnrollment] = useState<{
      uri: string;
      secret: string;
    } | null>(null),
    [qr, setQr] = useState(""),
    [code, setCode] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (enrollment)
      QRCode.toDataURL(enrollment.uri, { width: 200 }).then(setQr);
  }, [enrollment]);
  async function start() {
    setBusy(true);
    try {
      setEnrollment(await api("/auth/mfa/enroll", {}));
      setError("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="tracking">
      <ShieldCheck size={40} />
      <h1>Protect your administrator account.</h1>
      <p>
        Production finance and administration require a second sign-in factor.
        Add Tokenex to your authenticator app to continue.
      </p>
      {error && <p className="error">{error}</p>}
      {!enrollment ? (
        <button className="primary" disabled={busy} onClick={start}>
          Set up authenticator
        </button>
      ) : (
        <section className="panel">
          {qr && <img src={qr} alt="Authenticator enrollment QR code" />}
          <p>Or enter this setup key in your authenticator:</p>
          <code>{enrollment.secret}</code>
          <form
            className="spaced"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await api("/auth/mfa/confirm", { otp: code });
                onComplete();
              } catch (e: any) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Six-digit authenticator code
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                pattern="[0-9]{6}"
                autoComplete="one-time-code"
                required
              />
            </label>
            <button className="primary wide" disabled={busy}>
              Enable MFA and continue
            </button>
          </form>
        </section>
      )}
    </main>
  );
}
