import { createPortal } from "react-dom";
import { useEffect } from "react";
import { useCanvasEditor, useCanvasEditorValue, type CanvasShape } from "./canvas-editor";
import { useI18n } from "../../shared/i18n";
import { ChampagneParticleCanvas } from "./generation-placeholder-particles";

export const GENERATION_PLACEHOLDER_TYPE = "generation-placeholder" as const;
export { GENERATION_PLACEHOLDER_MOTION_CHANGE_EVENT, GENERATION_PLACEHOLDER_MOTION_QUIET_CLASS } from "./generation-placeholder-particles";

export type GenerationPlaceholderStatus = "loading" | "failed";

export interface GenerationPlaceholderShape extends CanvasShape {
  type: typeof GENERATION_PLACEHOLDER_TYPE;
  props: CanvasShape["props"] & {
    w: number;
    h: number;
    targetWidth: number;
    targetHeight: number;
    status: GenerationPlaceholderStatus;
    error: string;
    requestId: string;
    outputIndex: number;
  };
}

function isGenerationPlaceholder(shape: CanvasShape): shape is GenerationPlaceholderShape {
  return shape.type === GENERATION_PLACEHOLDER_TYPE && shape.props.status === "loading";
}

function GenerationPlaceholderLoadingArt({ label }: { label: string }) {
  return (
    <div className="generation-placeholder-shape__content">
      <div className="generation-placeholder-shape__art" aria-hidden="true">
        <svg className="generation-placeholder-shape__picture" viewBox="0 0 100 100" fill="none" focusable="false" xmlns="http://www.w3.org/2000/svg">
          <rect className="generation-placeholder-shape__draw" x="10" y="15" width="80" height="70" rx="12" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          <circle className="generation-placeholder-shape__draw generation-placeholder-shape__draw--sun" cx="70" cy="35" r="8" stroke="currentColor" strokeWidth="3" />
          <path className="generation-placeholder-shape__draw generation-placeholder-shape__draw--mountain-one" d="M10 70 L40 40 L65 65" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <path className="generation-placeholder-shape__draw generation-placeholder-shape__draw--mountain-two" d="M50 65 L65 50 L90 75" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <svg className="generation-placeholder-shape__spark generation-placeholder-shape__spark--large" viewBox="0 0 100 100" fill="none" focusable="false">
          <path d="M50 0 C50 25 75 50 100 50 C75 50 50 75 50 100 C50 75 25 50 0 50 C25 50 50 25 50 0 Z" fill="currentColor" opacity="0.8" />
        </svg>
        <svg className="generation-placeholder-shape__spark generation-placeholder-shape__spark--small" viewBox="0 0 100 100" fill="none" focusable="false">
          <path d="M50 0 C50 25 75 50 100 50 C75 50 50 75 50 100 C50 75 25 50 0 50 C25 50 50 25 50 0 Z" fill="currentColor" opacity="0.6" />
        </svg>
      </div>
      <div className="generation-placeholder-shape__status-panel" role="status" aria-label={label}>
        <span className="generation-placeholder-shape__dots" aria-hidden="true"><span /><span /><span /></span>
        <span className="generation-placeholder-shape__magic-text">{label}</span>
      </div>
    </div>
  );
}

function GenerationPlaceholderContent() {
  const { t } = useI18n();
  return (
    <div className="generation-placeholder-shape is-loading" data-generation-placeholder-status="loading">
      <ChampagneParticleCanvas />
      <div className="generation-placeholder-shape__inner-glow" aria-hidden="true" />
      <GenerationPlaceholderLoadingArt label={t("generationCanvasMagicLoading")} />
    </div>
  );
}

export function GenerationPlaceholderOverlay() {
  const editor = useCanvasEditor();
  const placeholders = useCanvasEditorValue(
    "loading generation placeholders",
    () => editor.getCurrentPageShapes().filter(isGenerationPlaceholder),
    [editor]
  );

  useEffect(() => {
    const activePointers = new Set<number>();
    const container = editor.getContainer();
    const handlePointerDown = (event: PointerEvent): void => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      const shape = editor.getShapeAtPoint(
        editor.screenToPage({ x: event.clientX, y: event.clientY }),
        { filter: isGenerationPlaceholder }
      );
      if (shape) activePointers.add(event.pointerId);
    };
    const handlePointerDone = (event: PointerEvent): void => {
      if (activePointers.delete(event.pointerId)) editor.selectNone();
    };

    container.addEventListener("pointerdown", handlePointerDown, { capture: true });
    window.addEventListener("pointerup", handlePointerDone);
    window.addEventListener("pointercancel", handlePointerDone);
    return () => {
      container.removeEventListener("pointerdown", handlePointerDown, { capture: true });
      window.removeEventListener("pointerup", handlePointerDone);
      window.removeEventListener("pointercancel", handlePointerDone);
    };
  }, [editor]);

  if (placeholders.length === 0) return null;
  const container = editor.getContainer();
  const containerBounds = container.getBoundingClientRect();

  return createPortal(
    <div className="generation-placeholder-overlay" data-testid="generation-placeholder-overlays">
      {placeholders.map((shape) => {
        const bounds = editor.getShapePageBounds(shape);
        if (!bounds) return null;
        const topLeft = editor.pageToScreen({ x: bounds.x, y: bounds.y });
        const bottomRight = editor.pageToScreen({ x: bounds.x + bounds.w, y: bounds.y + bounds.h });
        const scale = Math.abs(bottomRight.x - topLeft.x) / bounds.w;
        return (
          <div
            className="generation-placeholder-overlay__item"
            data-generation-placeholder-status="loading"
            data-testid="generation-placeholder"
            key={shape.id}
            style={{
              left: Math.min(topLeft.x, bottomRight.x) - containerBounds.left,
              top: Math.min(topLeft.y, bottomRight.y) - containerBounds.top,
              width: bounds.w,
              height: bounds.h,
              transform: `scale(${scale})`,
              transformOrigin: "top left"
            }}
          >
            <GenerationPlaceholderContent />
          </div>
        );
      })}
    </div>,
    container
  );
}
