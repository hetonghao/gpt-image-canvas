import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  sceneCoordsToViewportCoords,
  viewportCoordsToSceneCoords
} from "@excalidraw/excalidraw";
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement, FileId } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawProjectSnapshot } from "@gpt-image-canvas/shared";
import type {
  CanvasAsset,
  CanvasAssetId,
  CanvasBounds,
  CanvasEditor,
  CanvasExportFormat,
  CanvasImageShape,
  CanvasShape,
  CanvasShapeId,
  CanvasShapePartial
} from "./canvas-editor";
import { agentPlanTombstonesFromAppState } from "./agent-plan-canvas";
import { isPagePointInsideImage } from "./region-geometry";
import { ExcalidrawAssetStore } from "./excalidraw-asset-store";
import { CanvasAssetUnavailableError, exportCanvasScene } from "./excalidraw-export";
import {
  canvasBounds,
  deduplicateAgentPlanNodes,
  numericProp,
  shapeFromElement,
  shapeSkeleton,
  updateElement,
  updateImageFileStatus,
  viewportState
} from "./excalidraw-shapes";
import { createProjectSnapshot, type HydratedScene } from "./excalidraw-snapshot";

export class CanvasEditorRuntime implements CanvasEditor {
  readonly user = {
    getIsSnapMode: () => true,
    updateUserPreferences: (_preferences: { isSnapMode?: boolean }) => undefined
  };
  readonly store = { listen: (listener: () => void) => this.subscribe(listener) };
  private elements: readonly ExcalidrawElement[];
  private appState: AppState;
  private readonly assets: ExcalidrawAssetStore;
  private readonly listeners = new Set<() => void>();
  private readonly namedListeners = new Set<() => void>();
  private readonly removedAgentPlanIds: Set<string>;
  constructor(
    private readonly api: ExcalidrawImperativeAPI,
    hydrated: HydratedScene,
    onAuthenticationFailure: () => void
  ) {
    this.elements = api.getSceneElements();
    this.appState = api.getAppState();
    this.removedAgentPlanIds = agentPlanTombstonesFromAppState(hydrated.appState);
    this.assets = new ExcalidrawAssetStore(
      api,
      hydrated,
      {
        onAuthenticationFailure,
        onChange: () => this.emit(),
        onFileStatus: (fileId, status) => this.setImageFileStatus(fileId, status)
      }
    );
  }
  acceptChange(elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles): void {
    const deduplicated = deduplicateAgentPlanNodes(elements);
    this.elements = deduplicated;
    this.appState = appState;
    this.assets.acceptFiles(files);
    if (deduplicated.length !== elements.length) {
      this.api.updateScene({ elements: deduplicated, captureUpdate: CaptureUpdateAction.NEVER });
    }
    this.emit();
  }
  bringToFront(ids: CanvasShapeId[]): void {
    const selected = new Set(ids);
    this.updateElements([
      ...this.elements.filter((element) => !selected.has(element.id)),
      ...this.elements.filter((element) => selected.has(element.id))
    ]);
  }
  createAssets(assets: CanvasAsset[]): void { this.assets.upsertAssets(assets); }
  createShapes<TShape extends CanvasShape>(shapes: Array<CanvasShapePartial<TShape>>): void {
    const created = convertToExcalidrawElements(shapes.flatMap((shape) => shapeSkeleton(shape)), {
      regenerateIds: false
    });
    this.updateElements([...this.elements, ...created]);
  }

  deleteShapes(ids: CanvasShapeId[]): void {
    const deleted = new Set(ids);
    for (const element of this.elements) {
      if ("containerId" in element && element.containerId && deleted.has(element.containerId)) {
        deleted.add(element.id);
      }
    }
    this.updateElements(this.elements.filter((element) => !deleted.has(element.id)));
  }

  async exportScene(format: CanvasExportFormat): Promise<void> {
    const elements = this.api.getSceneElements();
    if (this.assets.hasUnavailableAssets(elements)) throw new CanvasAssetUnavailableError();
    await exportCanvasScene(format, elements, this.api.getAppState(), this.assets.files);
  }

  focusAtCursor(): void { this.getContainer().focus({ preventScroll: true }); }
  getAsset(id: CanvasAssetId): CanvasAsset | undefined { return this.assets.getAsset(id); }
  getAssets(): CanvasAsset[] { return this.assets.getAssets(); }

  getContainer(): HTMLElement {
    return document.querySelector<HTMLElement>("[data-testid='canvas-shell'] .excalidraw") ?? document.body;
  }

  getCurrentPage(): { id: string; name: string } { return { id: "excalidraw-scene", name: "画布" }; }
  getCurrentPageShapes(): CanvasShape[] {
    return this.elements
      .filter((element) => !element.isDeleted && element.type !== "selection")
      .map(shapeFromElement);
  }

  getSelectedShapes(): CanvasShape[] {
    return this.getCurrentPageShapes().filter((shape) => this.appState.selectedElementIds[shape.id]);
  }

  getShape(id: CanvasShapeId): CanvasShape | undefined {
    const element = this.elements.find((candidate) => candidate.id === id && !candidate.isDeleted);
    return element ? shapeFromElement(element) : undefined;
  }

  getShapeAtPoint(
    point: { x: number; y: number },
    options?: { filter?: (shape: CanvasShape) => boolean }
  ): CanvasShape | undefined {
    return this.getCurrentPageShapes().slice().reverse().find((shape) => {
      if (options?.filter && !options.filter(shape)) return false;
      if (shape.type === "image") return isPagePointInsideImage(shape as CanvasImageShape, point);
      const bounds = this.getShapePageBounds(shape);
      return Boolean(bounds && point.x >= bounds.x && point.x <= bounds.x + bounds.w &&
        point.y >= bounds.y && point.y <= bounds.y + bounds.h);
    });
  }

  getShapePageBounds(shape: CanvasShape | CanvasShapeId): CanvasBounds | undefined {
    const resolved = typeof shape === "string" ? this.getShape(shape) : shape;
    if (!resolved) return undefined;
    const w = numericProp(resolved.props.w);
    const h = numericProp(resolved.props.h);
    return w > 0 && h > 0 ? canvasBounds(resolved.x, resolved.y, w, h) : undefined;
  }

  getSnapshot(): ExcalidrawProjectSnapshot {
    return createProjectSnapshot(
      this.elements,
      this.appState,
      this.assets.snapshotReferences(this.elements),
      this.removedAgentPlanIds
    );
  }

  getViewportPageBounds(): CanvasBounds {
    const rect = this.getContainer().getBoundingClientRect();
    const topLeft = this.screenToPage({ x: rect.left, y: rect.top });
    const bottomRight = this.screenToPage({ x: rect.right, y: rect.bottom });
    return canvasBounds(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
  }

  getRemovedAgentPlanIds(): ReadonlySet<string> { return new Set(this.removedAgentPlanIds); }
  hasUnavailableAssets(): boolean { return this.assets.hasUnavailableAssets(this.elements); }
  isDarkMode(): boolean { return this.appState.theme === "dark"; }
  off(_event: "change", listener: () => void): void { this.namedListeners.delete(listener); }
  on(_event: "change", listener: () => void): void { this.namedListeners.add(listener); }

  pageToScreen(point: { x: number; y: number }): { x: number; y: number } {
    return sceneCoordsToViewportCoords({ sceneX: point.x, sceneY: point.y }, viewportState(this.appState));
  }

  renamePage(_id: string, _name: string): void {}
  retryAssets(assetIds?: string[]): void { this.assets.retryAssets(assetIds); }
  run(callback: () => void): void { callback(); }

  screenToPage(point: { x: number; y: number }): { x: number; y: number } {
    return viewportCoordsToSceneCoords({ clientX: point.x, clientY: point.y }, viewportState(this.appState));
  }

  select(...ids: CanvasShapeId[]): void {
    this.api.updateScene({
      appState: { selectedElementIds: Object.fromEntries(ids.map((id) => [id, true])) },
      captureUpdate: CaptureUpdateAction.NEVER
    });
  }

  selectNone(): void { this.select(); }

  setAgentPlanRemoved(planId: string, removed: boolean): void {
    const changed = removed ? !this.removedAgentPlanIds.has(planId) : this.removedAgentPlanIds.has(planId);
    if (!changed) return;
    if (removed) this.removedAgentPlanIds.add(planId);
    else this.removedAgentPlanIds.delete(planId);
    this.emit();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  updateAssets(assets: CanvasAsset[]): void { this.assets.upsertAssets(assets); }

  updateShapes<TShape extends CanvasShape>(shapes: Array<CanvasShapePartial<TShape>>): void {
    const updates = new Map(shapes.map((shape) => [shape.id, shape]));
    this.updateElements(this.elements.map((element) => {
      const update = updates.get(element.id);
      return update ? updateElement(element, update) : element;
    }));
  }

  zoomToBounds(target: CanvasBounds): void {
    const elements = this.elements.filter((element) => !element.isDeleted &&
      element.x < target.x + target.w && element.x + element.width > target.x &&
      element.y < target.y + target.h && element.y + element.height > target.y);
    this.api.scrollToContent(elements.length > 0 ? elements : this.elements);
  }

  zoomToSelection(): void {
    const ids = new Set(Object.keys(this.appState.selectedElementIds)
      .filter((id) => this.appState.selectedElementIds[id]));
    const elements = this.elements.filter((element) => ids.has(element.id));
    if (elements.length > 0) this.api.scrollToContent(elements);
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
    this.namedListeners.forEach((listener) => listener());
  }

  private updateElements(elements: readonly ExcalidrawElement[]): void {
    this.elements = elements;
    this.api.updateScene({ elements, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    this.emit();
  }

  private setImageFileStatus(fileId: FileId, status: "saved" | "error"): void {
    const elements = updateImageFileStatus(this.elements, fileId, status);
    if (elements === this.elements) return;
    this.elements = elements;
    this.api.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER });
  }
}
