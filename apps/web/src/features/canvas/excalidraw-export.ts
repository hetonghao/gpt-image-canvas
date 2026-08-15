import {
  exportToBlob,
  exportToSvg,
  serializeAsJSON
} from "@excalidraw/excalidraw";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { CanvasExportFormat } from "./canvas-editor";

export class CanvasAssetUnavailableError extends Error {
  constructor() {
    super("Canvas assets are unavailable.");
  }
}

export async function exportCanvasScene(
  format: CanvasExportFormat,
  elements: readonly ExcalidrawElement[],
  appState: AppState,
  files: BinaryFiles
): Promise<void> {
  if (format === "excalidraw") {
    downloadBlob(
      new Blob([serializeAsJSON(elements, appState, files, "local")], { type: "application/json" }),
      "ai-cove-canvas.excalidraw"
    );
    return;
  }
  if (format === "png") {
    downloadBlob(
      await exportToBlob({ elements, appState, files, mimeType: "image/png" }),
      "ai-cove-canvas.png"
    );
    return;
  }
  const svg = await exportToSvg({ elements, appState, files });
  downloadBlob(
    new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" }),
    "ai-cove-canvas.svg"
  );
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.download = fileName;
  link.href = url;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
