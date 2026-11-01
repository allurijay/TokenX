import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
if (!existsSync(".env"))
  writeFileSync(".env", readFileSync(".env.example", "utf8"));
let env = readFileSync(".env", "utf8");
if (!/^ENCRYPTION_KEY=[a-f0-9]{64}$/m.test(env)) {
  env =
    env.replace(/^ENCRYPTION_KEY=.*\n?/m, "") +
    "\nENCRYPTION_KEY=" +
    randomBytes(32).toString("hex") +
    "\n";
  writeFileSync(".env", env, { mode: 0o600 });
}
console.log(
  "Local environment prepared. Credentials are in .env; never commit this file.",
);
