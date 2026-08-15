import { useState } from "react";
import { useI18n } from "../../shared/i18n";
import type { CanvasEditor, CanvasExportFormat } from "./canvas-editor";
import { CanvasAssetUnavailableError } from "./excalidraw-export";

const exportFormatLabels = {
  excalidraw: "Excalidraw",
  png: "PNG",
  svg: "SVG"
} satisfies Record<CanvasExportFormat, string>;

export function CanvasExportControls({ editor }: { editor: CanvasEditor }) {
  const { t } = useI18n();
  const [exporting, setExporting] = useState<CanvasExportFormat | null>(null);
  const [error, setError] = useState<"asset" | "other" | null>(null);

  async function exportCanvas(format: CanvasExportFormat): Promise<void> {
    setError(null);
    setExporting(format);
    try {
      await editor.exportScene(format);
    } catch (caught) {
      setError(caught instanceof CanvasAssetUnavailableError ? "asset" : "other");
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="canvas-export" data-testid="canvas-export-controls">
      <span className="canvas-export__label">{t("canvasExportTitle")}</span>
      {(["excalidraw", "png", "svg"] as const).map((format) => (
        <button
          aria-label={`${t("canvasExportTitle")} ${exportFormatLabels[format]}`}
          data-testid={`canvas-export-${format}`}
          disabled={exporting !== null}
          key={format}
          type="button"
          onClick={() => void exportCanvas(format)}
        >
          {exporting === format ? "…" : exportFormatLabels[format]}
        </button>
      ))}
      {error ? (
        <div className="canvas-export__error" role="alert">
          <span>{error === "asset" ? t("canvasExportAssetUnavailable") : t("canvasExportFailed")}</span>
          {error === "asset" ? (
            <button
              type="button"
              onClick={() => {
                setError(null);
                editor.retryAssets();
              }}
            >
              {t("canvasExportRetryAssets")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
