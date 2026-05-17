import type { Hono } from "hono";
import type { GalleryExportRequest } from "../../domain/contracts.js";
import { createZipStream, prepareZipFiles, type ZipFileInput } from "../../domain/assets/zip.js";
import { getStoredAssetFile } from "../../domain/generation/image-generation.js";
import { deleteGalleryOutput, getGalleryExportAssets, getGalleryImages } from "../../domain/project/project-store.js";
import { downloadFileName, errorResponse } from "../http/errors.js";
import { requireHostContext } from "../host-context.js";

export function registerGalleryRoutes(app: Hono): void {
  app.get("/api/gallery", (c) => c.json(getGalleryImages(requireHostContext(c))));

  app.post("/api/gallery/export", async (c) => {
    const parsed = await parseGalleryExportRequest(c.req.raw);
    if (!parsed.ok) {
      return c.json(errorResponse(parsed.code, parsed.message), 400);
    }

    const hostContext = requireHostContext(c);
    const exportAssets = getGalleryExportAssets(parsed.outputIds, hostContext);
    if (exportAssets.length !== parsed.outputIds.length) {
      return c.json(errorResponse("gallery_export_not_found", "One or more Gallery images were not found."), 404);
    }

    const zipInputs: ZipFileInput[] = [];
    for (const [index, exportAsset] of exportAssets.entries()) {
      const file = getStoredAssetFile(exportAsset.assetId, hostContext);
      if (!file) {
        return c.json(errorResponse("gallery_export_asset_unavailable", "One or more Gallery assets are unavailable."), 404);
      }

      zipInputs.push({
        filePath: file.filePath,
        name: `${String(index + 1).padStart(3, "0")}-${downloadFileName(file.fileName)}`
      });
    }

    try {
      const zipFiles = await prepareZipFiles(zipInputs);
      return new Response(createZipStream(zipFiles), {
        status: 200,
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Disposition": `attachment; filename="${galleryExportFileName()}"`,
          "Content-Type": "application/zip"
        }
      });
    } catch {
      return c.json(errorResponse("gallery_export_asset_unavailable", "One or more Gallery assets are unavailable."), 404);
    }
  });

  app.delete("/api/gallery/:outputId", (c) => {
    const deleted = deleteGalleryOutput(c.req.param("outputId"), requireHostContext(c));
    if (!deleted) {
      return c.json(errorResponse("not_found", "Gallery image record not found."), 404);
    }

    return c.json({
      ok: true
    });
  });
}

type GalleryExportParseResult =
  | {
      ok: true;
      outputIds: string[];
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

async function parseGalleryExportRequest(request: Request): Promise<GalleryExportParseResult> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return {
      ok: false,
      code: "invalid_json",
      message: "Request body must be valid JSON."
    };
  }

  if (!isRecord(body) || !Array.isArray(body.outputIds)) {
    return {
      ok: false,
      code: "invalid_gallery_export_request",
      message: "Gallery export requires outputIds."
    };
  }

  const exportRequest: GalleryExportRequest = {
    outputIds: body.outputIds.filter((outputId): outputId is string => typeof outputId === "string")
  };
  const outputIds = normalizeOutputIds(exportRequest.outputIds);
  if (outputIds.length === 0) {
    return {
      ok: false,
      code: "gallery_export_empty",
      message: "Gallery export requires at least one image."
    };
  }

  return {
    ok: true,
    outputIds
  };
}

function normalizeOutputIds(value: unknown[]): string[] {
  const seen = new Set<string>();
  const outputIds: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }

    const outputId = item.trim();
    if (!outputId || seen.has(outputId)) {
      continue;
    }

    seen.add(outputId);
    outputIds.push(outputId);
  }

  return outputIds;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function galleryExportFileName(now = new Date()): string {
  const parts = [
    now.getFullYear(),
    pad2(now.getMonth() + 1),
    pad2(now.getDate()),
    "-",
    pad2(now.getHours()),
    pad2(now.getMinutes()),
    pad2(now.getSeconds())
  ];
  return `gpt-image-canvas-gallery-${parts.join("")}.zip`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
