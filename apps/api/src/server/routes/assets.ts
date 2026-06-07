import type { Hono } from "hono";
import { parsePreviewWidth, readStoredAssetPreview } from "../../domain/assets/preview.js";
import { readStoredAsset, readStoredAssetMetadata, saveUploadedImageAsset } from "../../domain/generation/image-generation.js";
import { ProviderError } from "../../infrastructure/providers/image-provider.js";
import { downloadFileName, errorResponse, providerErrorJson } from "../http/errors.js";
import { readJson } from "../http/json.js";
import { parseAssetUploadPayload } from "../http/validation.js";
import { requireHostContext } from "../host-context.js";

export function registerAssetRoutes(app: Hono): void {
  app.post("/api/assets", async (c) => {
    const payload = await readJson(c.req.raw);
    if (!payload.ok) {
      return c.json(payload.error, 400);
    }

    const parsed = parseAssetUploadPayload(payload.value);
    if (!parsed.ok) {
      return c.json(parsed.error, 400);
    }

    try {
      return c.json(await saveUploadedImageAsset(parsed.value, requireHostContext(c)));
    } catch (error) {
      if (error instanceof ProviderError) {
        return providerErrorJson(c, error);
      }

      console.error(error);
      return c.json(errorResponse("asset_upload_failed", "Asset upload failed."), 500);
    }
  });

  app.get("/api/assets/:id/preview", async (c) => {
    const parsedWidth = parsePreviewWidth(c.req.query("width"));
    if (!parsedWidth.ok) {
      return c.json(errorResponse(parsedWidth.code, parsedWidth.message), 400);
    }

    const preview = await readStoredAssetPreview(c.req.param("id"), parsedWidth.width, requireHostContext(c));
    if (!preview) {
      return c.json(errorResponse("not_found", "Asset not found."), 404);
    }

    return new Response(new Uint8Array(preview.bytes), {
      status: 200,
      headers: {
        "Cache-Control": "private, max-age=31536000, immutable",
        "Content-Disposition": `inline; filename="${downloadFileName(c.req.param("id"))}-${preview.width}.webp"`,
        "Content-Type": "image/webp"
      }
    });
  });

  app.get("/api/assets/:id/metadata", async (c) => {
    const metadata = await readStoredAssetMetadata(c.req.param("id"), requireHostContext(c));
    if (!metadata) {
      return c.json(errorResponse("not_found", "Asset not found."), 404);
    }

    return c.json(metadata);
  });

  app.get("/api/assets/:id/download", async (c) => {
    const asset = await readStoredAsset(c.req.param("id"), requireHostContext(c));
    if (!asset) {
      return c.json(errorResponse("not_found", "找不到请求的图像资源。"), 404);
    }

    return new Response(new Uint8Array(asset.bytes), {
      status: 200,
      headers: {
        "Cache-Control": "private, max-age=31536000, immutable",
        "Content-Disposition": `attachment; filename="${downloadFileName(asset.file.fileName)}"`,
        "Content-Type": asset.file.mimeType
      }
    });
  });

  app.get("/api/assets/:id", async (c) => {
    const asset = await readStoredAsset(c.req.param("id"), requireHostContext(c));
    if (!asset) {
      return c.json(errorResponse("not_found", "找不到请求的图像资源。"), 404);
    }

    return new Response(new Uint8Array(asset.bytes), {
      status: 200,
      headers: {
        "Cache-Control": "private, max-age=31536000, immutable",
        "Content-Disposition": `inline; filename="${asset.file.fileName}"`,
        "Content-Type": asset.file.mimeType
      }
    });
  });
}
