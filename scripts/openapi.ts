import { writeFile } from "node:fs/promises";
import { z } from "zod";
import { buildApp } from "../apps/api/src/app.js";
import { pool } from "../packages/db/src.js";
import {
  quoteInput,
  checkoutInput,
  transitionInput,
  refundInput,
  decisionInput,
  id,
  money,
} from "../packages/contracts/src/index.js";
import { configSchemas } from "../apps/api/src/configuration.js";
const app = await buildApp();
await app.ready();
const spec: any = app.swagger();
const schemas: Record<string, z.ZodType> = {
  "/v1/quotes": quoteInput,
  "/v1/checkouts": checkoutInput,
  "/v1/units/transition": transitionInput,
  "/v1/orders/{id}/refund-requests": refundInput,
  "/v1/refund-requests/{id}/decision": decisionInput,
  "/v1/auth/login": z.object({
    email: z.email(),
    password: z.string(),
    otp: z.string().optional(),
  }),
  "/v1/payments/{id}/confirm-cash": z.object({
    shiftId: id,
    receivedMinor: money,
  }),
};
for (const [name, schema] of Object.entries(configSchemas)) {
  schemas["/v1/" + name] = schema;
  schemas["/v1/" + name + "/{id}"] = schema.extend({
    version: z.number().int(),
  });
}
spec.components.schemas = {
  Error: {
    type: "object",
    required: ["error"],
    properties: {
      error: {
        type: "object",
        required: ["code", "message", "retryable"],
        properties: {
          code: { type: "string" },
          message: { type: "string" },
          retryable: { type: "boolean" },
          fieldErrors: { type: "object" },
        },
      },
      requestId: { type: "string" },
    },
  },
  Unit: {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      name: { type: "string" },
      outlet_id: { type: "string", format: "uuid" },
      station_id: { type: "string", format: "uuid" },
      prep_state: {
        enum: ["RECEIVED", "ACKNOWLEDGED", "PREPARING", "COMPLETED"],
      },
      serve_state: { enum: ["WAITING", "READY_FOR_PICKUP", "HANDED_OVER"] },
      cancel_state: { enum: ["ACTIVE", "CANCEL_REQUESTED", "CANCELLED"] },
      version: { type: "integer" },
      amount_minor: { type: "integer", minimum: 0 },
    },
  },
};
for (const [path, operations] of Object.entries<any>(spec.paths)) {
  for (const [method, op] of Object.entries<any>(operations)) {
    if (!["get", "post", "put", "delete"].includes(method)) continue;
    op.parameters ??= [];
    if (
      ["post", "put", "delete"].includes(method) &&
      !path.includes("/auth/") &&
      !path.includes("/webhooks/")
    )
      op.parameters.push({
        name: "Idempotency-Key",
        in: "header",
        required: !path.includes("/payments/") && !path.includes("/image"),
        schema: { type: "string", minLength: 8, maxLength: 160 },
        description:
          "Permanent operation key. Same key with a changed body returns 409.",
      });
    if (schemas[path] && method !== "get") {
      const js: any = z.toJSONSchema(schemas[path], {
        target: "draft-7",
        io: "input",
      });
      delete js.$schema;
      op.requestBody = {
        required: true,
        content: { "application/json": { schema: js } },
      };
    }
    op.responses = {
      ...op.responses,
      200: {
        description:
          "Successful scoped response. Currency values are integer minor units.",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                data: {},
                meta: {
                  type: "object",
                  properties: { requestId: { type: "string" } },
                },
              },
            },
          },
        },
      },
      400: {
        description: "Invalid request",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
          },
        },
      },
      401: { description: "Session expired" },
      403: { description: "Scope or capability denied" },
      404: { description: "Absent or inaccessible resource" },
      409: { description: "State/version/idempotency conflict" },
      429: { description: "Rate limited" },
      503: { description: "Dependency or launch gate unavailable" },
    };
  }
}
spec.info.description =
  "Tokenex + KitchQ. Cookie sessions, same-origin commands, server-authoritative money and scoped projections. See docs/API.md for workflow contracts and provider recovery.";
await writeFile("docs/openapi.json", JSON.stringify(spec, null, 2) + "\n");
await app.close();
await pool.end();
console.log("Generated docs/openapi.json");
