import { type FastifyRequest } from "fastify";
import { type DB, one } from "../../../packages/db/src.js";
import {
  assert,
  hash,
  type Principal,
} from "../../../packages/domain/src/index.js";
export async function principal(
  db: DB,
  req: FastifyRequest,
): Promise<Principal> {
  const token = req.cookies.tokenex_session;
  assert(token, "UNAUTHENTICATED", "Please sign in", 401);
  const p = await one(
    db,
    "SELECT u.id,u.organization_id,u.email,u.name,u.mfa_enabled FROM session s JOIN app_user u ON u.id=s.user_id WHERE s.id_hash=$1 AND s.expires_at>now() AND u.active",
    [hash(token)],
  );
  assert(p, "UNAUTHENTICATED", "Your session has expired", 401);
  p.grants = (
    await db.query(
      "SELECT role,venue_id,outlet_id,station_id,capabilities FROM role_assignment WHERE user_id=$1",
      [p.id],
    )
  ).rows;
  assert(p.grants.length, "FORBIDDEN", "No active assignment", 403);
  if (
    process.env.NODE_ENV === "production" &&
    p.grants.some(
      (g: any) =>
        g.role === "SUPER_ADMIN" || g.capabilities.includes("finance"),
    ) &&
    !p.mfa_enabled
  )
    assert(
      req.url.startsWith("/v1/auth/mfa") || req.url === "/v1/me",
      "MFA_ENROLLMENT_REQUIRED",
      "Enroll in multi-factor authentication",
      403,
    );
  return p;
}
