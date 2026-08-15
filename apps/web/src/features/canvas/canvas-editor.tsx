import {
  createContext,
  useContext,
  useEffect,
  useState,
  type DependencyList,
  type ReactNode
} from "react";
import type { ExcalidrawProjectSnapshot } from "@gpt-image-canvas/shared";

export type CanvasShapeId = string;
export type CanvasAssetId = string;
export type CanvasExportFormat = "excalidraw" | "png" | "svg";

export interface CanvasAsset {
  id: CanvasAssetId;
  typeName?: "asset";
  type: "image";
  props: {
    src: string | null;
    w: number;
    h: number;
    name: string;
    mimeType: string;
    isAnimated?: boolean;
  };
  meta: {
    localAssetId?: string;
    originalUrl?: string;
    byteSize?: number;
    contentSha256?: string;
    previewRetryToken?: string;
  };
}

export interface CanvasShape {
  id: CanvasShapeId;
  type: string;
  x: number;
  y: number;
  rotation?: number;
  props: Record<string, unknown> & {
    w?: number;
    h?: number;
  };
}

export interface CanvasImageCrop {
  x: number;
  y: number;
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
}

export interface CanvasImageShape extends CanvasShape {
  type: "image";
  props: CanvasShape["props"] & {
    assetId: CanvasAssetId | null;
    w: number;
    h: number;
    url?: string;
    crop?: CanvasImageCrop | null;
    flipX?: boolean;
    flipY?: boolean;
    altText?: string;
  };
}

export type CanvasShapePartial<TShape extends CanvasShape = CanvasShape> = Pick<TShape, "id" | "type"> &
  Partial<Omit<TShape, "id" | "type" | "props">> & {
    props?: Partial<TShape["props"]>;
  };

export interface CanvasBounds {
  x: number;
  y: number;
  w: number;
  h: number;
  center: { x: number; y: number };
}

export interface CanvasEditor {
  bringToFront(ids: CanvasShapeId[]): void;
  createAssets(assets: CanvasAsset[]): void;
  createShapes<TShape extends CanvasShape>(shapes: Array<CanvasShapePartial<TShape>>): void;
  deleteShapes(ids: CanvasShapeId[]): void;
  exportScene(format: CanvasExportFormat): Promise<void>;
  focusAtCursor(): void;
  getAsset(id: CanvasAssetId): CanvasAsset | undefined;
  getAssets(): CanvasAsset[];
  getContainer(): HTMLElement;
  getCurrentPage(): { id: string; name: string };
  getCurrentPageShapes(): CanvasShape[];
  getSelectedShapes(): CanvasShape[];
  getShape(id: CanvasShapeId): CanvasShape | undefined;
  getShapeAtPoint(
    point: { x: number; y: number },
    options?: { filter?: (shape: CanvasShape) => boolean; hitInside?: boolean; renderingOnly?: boolean }
  ): CanvasShape | undefined;
  getShapePageBounds(shape: CanvasShape | CanvasShapeId): CanvasBounds | undefined;
  getSnapshot(): ExcalidrawProjectSnapshot;
  getViewportPageBounds(): CanvasBounds;
  getRemovedAgentPlanIds(): ReadonlySet<string>;
  hasUnavailableAssets(): boolean;
  isDarkMode(): boolean;
  off(event: "change", listener: () => void): void;
  on(event: "change", listener: () => void): void;
  pageToScreen(point: { x: number; y: number }): { x: number; y: number };
  renamePage(id: string, name: string): void;
  retryAssets(assetIds?: string[]): void;
  run(callback: () => void): void;
  screenToPage(point: { x: number; y: number }): { x: number; y: number };
  select(...ids: CanvasShapeId[]): void;
  selectNone(): void;
  setAgentPlanRemoved(planId: string, removed: boolean): void;
  subscribe(listener: () => void): () => void;
  updateAssets(assets: CanvasAsset[]): void;
  updateShapes<TShape extends CanvasShape>(shapes: Array<CanvasShapePartial<TShape>>): void;
  user: {
    getIsSnapMode(): boolean;
    updateUserPreferences(preferences: { isSnapMode?: boolean }): void;
  };
  store: {
    listen(listener: () => void, options?: { source?: "all" | "user"; scope?: "all" | "document" }): () => void;
  };
  zoomToBounds(bounds: CanvasBounds, options?: { animation?: { duration: number }; inset?: number }): void;
  zoomToSelection(options?: { animation?: { duration: number } }): void;
}

const CanvasEditorContext = createContext<CanvasEditor | null>(null);

export function CanvasEditorProvider({ children, editor }: { children: ReactNode; editor: CanvasEditor }) {
  return <CanvasEditorContext.Provider value={editor}>{children}</CanvasEditorContext.Provider>;
}

export function useCanvasEditor(): CanvasEditor {
  const editor = useContext(CanvasEditorContext);
  if (!editor) {
    throw new Error("Canvas editor is unavailable outside the Excalidraw surface.");
  }
  return editor;
}

export function useCanvasEditorValue<T>(
  _name: string,
  read: () => T,
  dependencies: DependencyList
): T {
  const editor = useCanvasEditor();
  const [, setVersion] = useState(0);

  useEffect(() => editor.subscribe(() => setVersion((version) => version + 1)), [editor]);
  return readWithDependencies(read, dependencies);
}

function readWithDependencies<T>(read: () => T, _dependencies: DependencyList): T {
  return read();
}
