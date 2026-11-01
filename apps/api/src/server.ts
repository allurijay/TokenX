import serveStatic from "@fastify/static";
import { resolve } from "node:path";
import { buildApp } from "./app.js";
import { pool } from "../../../packages/db/src.js";
const app = await buildApp();
if (
  process.env.NODE_ENV === "production" &&
  process.env.PAYMENT_PROVIDER === "sandbox"
)
  throw new Error(
    "Production cannot start with sandbox payments. Complete provider certification and launch decisions.",
  );
if (process.env.SERVE_WEB === "true") {
  await app.register(serveStatic, {
    root: resolve("apps/web/dist"),
    prefix: "/",
  });
  app.setNotFoundHandler((req, reply) => {
    if (req.method === "GET" && !req.url.startsWith("/v1"))
      return reply.sendFile("index.html");
    return reply
      .code(404)
      .send({ error: { code: "NOT_FOUND", message: "Endpoint not found" } });
  });
}
await app.listen({
  port: Number(process.env.PORT || 4100),
  host: process.env.HOST || "127.0.0.1",
});
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
