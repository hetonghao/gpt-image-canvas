import { Excalidraw } from "@excalidraw/excalidraw";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import "@excalidraw/excalidraw/index.css";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import type { ExcalidrawProjectSnapshot } from "@gpt-image-canvas/shared";
import { useI18n, type Translate } from "../../shared/i18n";
import { CanvasEditorProvider, type CanvasEditor } from "./canvas-editor";
import { CanvasExportControls } from "./CanvasExportControls";
import { isAuthenticationFailure } from "./excalidraw-asset-io";
import { CanvasEditorRuntime } from "./excalidraw-editor-runtime";
import {
  hydrateProjectSnapshot,
  type HydratedScene
} from "./excalidraw-snapshot";
import { GenerationPlaceholderOverlay } from "./GenerationPlaceholderShape";

export interface ExcalidrawCanvasProps {
  locale: "zh-CN" | "en";
  overlays?: ReactNode;
  snapshot: ExcalidrawProjectSnapshot | null;
  theme: "dark" | "light";
  onMount(editor: CanvasEditor): void | (() => void);
}

type CanvasFatalError =
  | { readonly kind: "authentication" }
  | { readonly kind: "unexpected"; readonly message: string };

export function ExcalidrawCanvas({
  locale,
  onMount,
  overlays,
  snapshot,
  theme
}: ExcalidrawCanvasProps) {
  const [attempt, setAttempt] = useState(0);
  const [elapsedStage, setElapsedStage] = useState<"initial" | "slow" | "very-slow">("initial");
  const [fatalError, setFatalError] = useState<CanvasFatalError | null>(null);
  const [hydrated, setHydrated] = useState<HydratedScene | null>(null);
  const [editor, setEditor] = useState<CanvasEditor | null>(null);
  const [imageSelected, setImageSelected] = useState(false);
  const [imageCropping, setImageCropping] = useState(false);
  const { t } = useI18n();
  const canvasRootRef = useRef<HTMLDivElement | null>(null);
  const cleanupRef = useRef<void | (() => void)>();
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const runtimeRef = useRef<CanvasEditorRuntime | null>(null);

  const croppingHint = t("canvasImageCroppingHint");
  useLayoutEffect(() => {
    canvasRootRef.current?.style.setProperty("--canvas-image-cropping-hint", `"${croppingHint}"`);
  }, [croppingHint, hydrated]);

  useEffect(() => {
    setElapsedStage("initial");
    const slowTimer = window.setTimeout(() => setElapsedStage("slow"), 3_000);
    const verySlowTimer = window.setTimeout(() => setElapsedStage("very-slow"), 15_000);
    return () => {
      window.clearTimeout(slowTimer);
      window.clearTimeout(verySlowTimer);
    };
  }, [attempt, snapshot]);

  useEffect(() => {
    const controller = new AbortController();
    setHydrated(null);
    setFatalError(null);
    void hydrateProjectSnapshot(snapshot, controller.signal)
      .then((scene) => {
        if (!controller.signal.aborted) setHydrated(scene);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setFatalError(isAuthenticationFailure(error)
            ? { kind: "authentication" }
            : { kind: "unexpected", message: error instanceof Error ? error.message : "" });
        }
      });
    return () => controller.abort();
  }, [attempt, snapshot]);

  useEffect(() => () => cleanupRef.current?.(), []);

  const blockForAuthenticationFailure = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = undefined;
    apiRef.current = null;
    runtimeRef.current = null;
    setEditor(null);
    setFatalError({ kind: "authentication" });
  }, []);

  const setExcalidrawApi = useCallback(
    (api: ExcalidrawImperativeAPI) => {
      if (!hydrated || apiRef.current === api) return;
      cleanupRef.current?.();
      apiRef.current = api;
      const runtime = new CanvasEditorRuntime(api, hydrated, blockForAuthenticationFailure);
      runtimeRef.current = runtime;
      setEditor(runtime);
      cleanupRef.current = onMount(runtime);
    },
    [blockForAuthenticationFailure, hydrated, onMount]
  );

  const initialData = useMemo(
    () => hydrated
      ? {
          elements: hydrated.elements,
          appState: hydrated.appState,
          files: hydrated.files,
          scrollToContent: true
        }
      : null,
    [hydrated]
  );

  if (fatalError) {
    return (
      <CanvasStartupState
        error={fatalError}
        stage="error"
        onRetry={() => setAttempt((value) => value + 1)}
      />
    );
  }
  if (!hydrated || !initialData) {
    return (
      <CanvasStartupState
        stage={elapsedStage}
        onRetry={elapsedStage === "very-slow" ? () => setAttempt((value) => value + 1) : undefined}
      />
    );
  }

  return (
    <div
      className="excalidraw-canvas-runtime"
      data-image-cropping={imageCropping ? "true" : undefined}
      data-image-selected={imageSelected ? "true" : undefined}
      data-testid="excalidraw-canvas"
      data-theme={theme}
      ref={canvasRootRef}
    >
      <Excalidraw
        excalidrawAPI={setExcalidrawApi}
        initialData={initialData}
        langCode={locale}
        theme={theme}
        UIOptions={{
          canvasActions: {
            export: false,
            loadScene: false,
            saveToActiveFile: false,
            toggleTheme: true
          }
        }}
        onChange={(elements, appState, files) => {
          setImageCropping(Boolean(appState.croppingElementId));
          setImageSelected(hasSingleSelectedImage(elements, appState));
          runtimeRef.current?.acceptChange(elements, appState, files);
        }}
      >
        <CanvasExportControls />
      </Excalidraw>
      {editor ? (
        <CanvasEditorProvider editor={editor}>
          {overlays}
          <GenerationPlaceholderOverlay />
        </CanvasEditorProvider>
      ) : null}
    </div>
  );
}

function hasSingleSelectedImage(elements: readonly ExcalidrawElement[], appState: AppState): boolean {
  if (appState.croppingElementId) return false;
  const selected = elements.filter((element) => appState.selectedElementIds[element.id]);
  return selected.length === 1 && selected[0]?.type === "image";
}

function CanvasStartupState({
  error,
  onRetry,
  stage
}: {
  error?: CanvasFatalError;
  onRetry?: () => void;
  stage: "initial" | "slow" | "very-slow" | "error";
}) {
  const { t } = useI18n();
  const title = stage === "error"
    ? t("canvasStartupErrorTitle")
    : stage === "very-slow"
      ? t("canvasStartupSlowTitle")
      : t("canvasLoadingTitle");
  const copy = error
    ? canvasFatalErrorMessage(error, t)
    : stage === "very-slow"
      ? t("canvasStartupSlowCopy")
      : t("canvasStartupLoadingCopy");
  return (
    <div
      className="canvas-loading-state canvas-engine-loading"
      data-stage={stage}
      data-testid="canvas-startup-state"
      role={stage === "error" ? "alert" : "status"}
    >
      <div>
        <p className="text-sm font-semibold text-neutral-800">{title}</p>
        <p className="mt-1 text-xs text-neutral-500">{copy}</p>
        {onRetry ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="primary-action h-11 px-3 text-xs" type="button" onClick={onRetry}>
              {t("canvasStartupRetry")}
            </button>
            <a className="secondary-action h-11 px-3 text-xs no-underline" href="/">
              {t("canvasStartupBackHome")}
            </a>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function canvasFatalErrorMessage(error: CanvasFatalError, t: Translate): string {
  switch (error.kind) {
    case "authentication":
      return t("canvasStartupAuthenticationError");
    case "unexpected":
      return error.message || t("canvasStartupUnexpectedError");
    default:
      return assertNever(error);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled canvas fatal error: ${JSON.stringify(value)}`);
}
