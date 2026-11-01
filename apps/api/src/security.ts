import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import * as OTPAuth from "otpauth";
import { assert } from "../../../packages/domain/src/index.js";
function key() {
  const value = process.env.ENCRYPTION_KEY;
  assert(
    value && /^[a-f0-9]{64}$/i.test(value),
    "SECURITY_CONFIG",
    "Configure ENCRYPTION_KEY before enabling MFA",
    503,
  );
  return Buffer.from(value, "hex");
}
export function encrypt(value: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), iv);
  return [
    iv.toString("hex"),
    cipher.update(value, "utf8", "hex") + cipher.final("hex"),
    cipher.getAuthTag().toString("hex"),
  ].join(":");
}
export function decrypt(value: string) {
  const [iv, body, tag] = value.split(":");
  const cipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "hex"));
  cipher.setAuthTag(Buffer.from(tag, "hex"));
  return cipher.update(body, "hex", "utf8") + cipher.final("utf8");
}
export function totp(email: string, secret?: string) {
  return new OTPAuth.TOTP({
    issuer: "Tokenex",
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: secret
      ? OTPAuth.Secret.fromBase32(secret)
      : new OTPAuth.Secret({ size: 20 }),
  });
}
export function verifyOtp(email: string, encrypted: string, code: string) {
  return (
    totp(email, decrypt(encrypted)).validate({ token: code, window: 1 }) !==
    null
  );
}
