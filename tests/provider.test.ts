import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { signatureValid } from "../packages/adapters/src/razorpay.js";
import { encrypt, decrypt, totp, verifyOtp } from "../apps/api/src/security.js";
test("provider signature validates exact raw bytes and rejects malformed/replayed-body signatures", () => {
  const secret = "test-secret",
    body = '{"event":"payment.captured"}';
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  assert.equal(signatureValid(body, signature, secret), true);
  assert.equal(signatureValid(body + " ", signature, secret), false);
  assert.equal(signatureValid(body, "00", secret), false);
});
test("MFA secrets are encrypted and authenticator codes validated", () => {
  process.env.ENCRYPTION_KEY = "a".repeat(64);
  const otp = totp("test@example.com");
  const ciphertext = encrypt(otp.secret.base32);
  assert.notEqual(ciphertext, otp.secret.base32);
  assert.equal(decrypt(ciphertext), otp.secret.base32);
  assert.equal(verifyOtp("test@example.com", ciphertext, otp.generate()), true);
  assert.equal(verifyOtp("test@example.com", ciphertext, "invalid"), false);
});
