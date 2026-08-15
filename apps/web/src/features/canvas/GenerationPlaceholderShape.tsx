import type { CanvasShape } from "./canvas-editor";

export const GENERATION_PLACEHOLDER_TYPE = "generation-placeholder" as const;
export const GENERATION_PLACEHOLDER_MOTION_QUIET_CLASS = "generation-placeholder-motion-quiet" as const;
export const GENERATION_PLACEHOLDER_MOTION_CHANGE_EVENT = "generation-placeholder-motion-change" as const;

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
