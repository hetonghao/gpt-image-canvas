import assert from "node:assert/strict";
import test from "node:test";
import type { CanvasAssetReference } from "@gpt-image-canvas/shared";
import type { CanvasImageShape } from "./canvas-editor";
import { assetFromReference, fetchAssetFile } from "./excalidraw-asset-io";
import { shapeSkeleton } from "./excalidraw-shapes";

test("hydrates and inserts a generated asset as a displayable Excalidraw image", async () => {
  // Given: a generated asset is available through the authenticated asset endpoint.
  const platformAssetId = "generated-asset";
  const fileId = "generated-file";
  const bytes = new TextEncoder().encode("generated-image-bytes");
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const contentSha256 = Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0")
  ).join("");
  const reference = {
    assetId: platformAssetId,
    fileName: "generated.png",
    mimeType: "image/png",
    width: 64,
    height: 48,
    byteSize: bytes.byteLength,
    contentSha256
  } satisfies CanvasAssetReference;

  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (input: RequestInfo | URL) => {
      assert.equal(String(input), `/api/assets/${platformAssetId}`);
      return new Response(bytes, { status: 200, headers: { "Content-Type": reference.mimeType } });
    }
  });
  Object.defineProperty(globalThis, "createImageBitmap", {
    configurable: true,
    value: async () => ({ width: reference.width, height: reference.height, close: () => undefined })
  });
  Object.defineProperty(globalThis, "FileReader", {
    configurable: true,
    value: class {
      result: string | null = null;
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;

      readAsDataURL(_blob: Blob): void {
        this.result = "data:image/png;base64,Z2VuZXJhdGVkLWltYWdlLWJ5dGVz";
        this.onload?.();
      }
    }
  });

  // When: the canvas creates the Excalidraw image skeleton and hydrates its linked file.
  const skeleton = shapeSkeleton<CanvasImageShape>({
    id: "generated-shape",
    type: "image",
    x: 12,
    y: 34,
    props: { assetId: fileId, w: reference.width, h: reference.height, altText: "generated result" }
  })[0];
  assert.ok(skeleton);
  assert.equal(skeleton.type, "image");
  if (skeleton.type !== "image" || !skeleton.fileId) assert.fail("Excalidraw image should reference a file");
  const file = await fetchAssetFile(reference, skeleton.fileId);
  const asset = assetFromReference(skeleton.fileId, reference);

  // Then: Excalidraw can display the hydrated file through the same id used by the inserted image.
  assert.equal(skeleton.status, "saved");
  assert.equal(skeleton.fileId, file.id);
  assert.match(file.dataURL, /^data:image\/png;base64,/u);
  assert.equal(asset.id, skeleton.fileId);
  assert.equal(asset.props.src, `/api/assets/${platformAssetId}`);
  assert.equal(asset.props.w, reference.width);
  assert.equal(asset.props.h, reference.height);
  assert.equal(asset.meta.localAssetId, platformAssetId);
  assert.equal(asset.meta.originalUrl, `/api/assets/${platformAssetId}`);
});
