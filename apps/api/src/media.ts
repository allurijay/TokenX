import type { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import sharp from "sharp";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { transaction, one } from "../../../packages/db/src.js";
import {
  assert,
  hash,
  requirePermission,
} from "../../../packages/domain/src/index.js";
import { principal } from "./auth.js";
import { venueFor } from "./catalog.js";
import { audit, emit } from "./common.js";
import { id } from "../../../packages/contracts/src/index.js";
export async function mediaRoutes(app: FastifyInstance) {
  await app.register(multipart, {
    limits: { files: 1, fileSize: 5 * 1024 * 1024 },
  });
  const directory = resolve(process.env.MEDIA_DIR || "var/media");
  await mkdir(directory, { recursive: true });
  app.post("/v1/menu-items/:id/image", async (req) => {
    const itemId = id.parse((req.params as any).id);
    const scope = await transaction(async (db) => {
      const p = await principal(db, req);
      const item = await one(
        db,
        "SELECT i.*,o.venue_id FROM menu_item i JOIN outlet o ON o.id=i.outlet_id WHERE i.id=$1",
        [itemId],
      );
      assert(item, "NOT_FOUND", "Item not found", 404);
      await venueFor(db, p, item.venue_id);
      requirePermission(p, "configure", item.venue_id, item.outlet_id);
      return { p, item };
    });
    const upload = await req.file();
    assert(
      upload &&
        ["image/jpeg", "image/png", "image/webp"].includes(upload.mimetype),
      "INVALID_IMAGE",
      "Upload a JPEG, PNG or WebP image up to 5 MB",
      400,
    );
    const input = await upload.toBuffer();
    const image = await sharp(input, { limitInputPixels: 25_000_000 })
      .rotate()
      .resize(900, 600, { fit: "cover" })
      .webp({ quality: 85 })
      .toBuffer();
    const filename = randomUUID() + ".webp";
    await writeFile(resolve(directory, filename), image, { flag: "wx" });
    const path = "/v1/media/" + filename;
    await transaction(async (db) => {
      const p = await principal(db, req);
      requirePermission(
        p,
        "configure",
        scope.item.venue_id,
        scope.item.outlet_id,
      );
      await db.query(
        "INSERT INTO media_asset(venue_id,outlet_id,path,mime_type,width,height,sha256,created_by) VALUES($1,$2,$3,$4,900,600,$5,$6)",
        [
          scope.item.venue_id,
          scope.item.outlet_id,
          path,
          "image/webp",
          hash(image.toString("base64")),
          p.id,
        ],
      );
      await db.query(
        "UPDATE menu_item SET image_url=$2,version=version+1 WHERE id=$1",
        [itemId, path],
      );
      await db.query(
        "UPDATE venue SET menu_version=menu_version+1 WHERE id=$1",
        [scope.item.venue_id],
      );
      await audit(
        db,
        p,
        scope.item.venue_id,
        scope.item.outlet_id,
        "menu.image_updated",
        itemId,
      );
      await emit(
        db,
        scope.item.venue_id,
        scope.item.outlet_id,
        null,
        "menu.changed",
        {},
      );
    });
    return { data: { path } };
  });
  app.get("/v1/media/:filename", async (req, reply) => {
    const filename = (req.params as any).filename;
    assert(
      /^[a-f0-9-]{36}\.webp$/.test(filename),
      "NOT_FOUND",
      "Image not found",
      404,
    );
    try {
      const bytes = await readFile(resolve(directory, filename));
      return reply
        .type("image/webp")
        .header("Cache-Control", "public, max-age=31536000, immutable")
        .send(bytes);
    } catch {
      throw Object.assign(new Error("Image not found"), { statusCode: 404 });
    }
  });
}
