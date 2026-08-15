import { useCallback, useMemo, useState } from "react"
import { createRoot } from "react-dom/client"
import {
  CaptureUpdateAction,
  Excalidraw,
  convertToExcalidrawElements,
  restore,
  serializeAsJSON,
} from "@excalidraw/excalidraw"
import type {
  BinaryFiles,
  DataURL,
  ExcalidrawElement,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types"
import "@excalidraw/excalidraw/index.css"
import "./styles.css"

const IMAGE_FILE_ID = "poc-image-file"
const IMAGE_DATA_URL = `data:image/svg+xml;base64,${btoa(
  `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420">
    <rect width="640" height="420" rx="28" fill="#f0dfc5"/>
    <circle cx="164" cy="150" r="74" fill="#177f7a"/>
    <path d="M82 332 252 204l96 80 86-72 126 120H82Z" fill="#bb6d49"/>
    <text x="320" y="92" fill="#2b2522" font-family="sans-serif" font-size="32" text-anchor="middle">AI Cove image asset</text>
  </svg>`,
)}` as DataURL

const imageFiles: BinaryFiles = {
  [IMAGE_FILE_ID]: {
    id: IMAGE_FILE_ID,
    mimeType: "image/svg+xml",
    dataURL: IMAGE_DATA_URL,
    created: Date.now(),
  },
}

type SceneState = {
  elements: readonly ExcalidrawElement[]
  appState: Record<string, unknown>
  files: BinaryFiles
}

const businessData = (kind: string, extra: Record<string, unknown> = {}) => ({
  "ai-cove": {
    kind,
    schemaVersion: 1,
    ...extra,
  },
})

function makeInitialScene(): SceneState {
  const elements = convertToExcalidrawElements([
    {
      id: "poc-image",
      type: "image",
      x: 80,
      y: 100,
      width: 420,
      height: 276,
      fileId: IMAGE_FILE_ID,
      customData: businessData("canvas-image", { assetId: "demo-asset-001" }),
    },
    {
      id: "poc-placeholder",
      type: "rectangle",
      x: 560,
      y: 110,
      width: 300,
      height: 180,
      strokeColor: "#bb6d49",
      backgroundColor: "#f6e6d5",
      fillStyle: "solid",
      customData: businessData("generation-placeholder", {
        requestId: "demo-request-001",
        status: "generating",
      }),
    },
    {
      id: "poc-placeholder-label",
      type: "text",
      x: 600,
      y: 180,
      text: "生成中…\n外部面板承载操作",
      fontSize: 22,
      strokeColor: "#6f4e40",
      customData: businessData("generation-placeholder-label", {
        requestId: "demo-request-001",
      }),
    },
    {
      id: "poc-plan",
      type: "rectangle",
      x: 80,
      y: 450,
      width: 520,
      height: 190,
      strokeColor: "#177f7a",
      backgroundColor: "#e2f1ee",
      fillStyle: "solid",
      customData: businessData("agent-plan", {
        planId: "demo-plan-001",
        status: "draft",
        selectedJobId: "job-001",
      }),
    },
    {
      id: "poc-plan-label",
      type: "text",
      x: 115,
      y: 490,
      text: "Agent 计划\n1. 构图草案\n2. 生成两张候选图",
      fontSize: 24,
      strokeColor: "#155b58",
      customData: businessData("agent-plan-label", { planId: "demo-plan-001" }),
    },
    {
      id: "poc-reference",
      type: "rectangle",
      x: 670,
      y: 420,
      width: 300,
      height: 220,
      strokeColor: "#177f7a",
      strokeStyle: "dashed",
      backgroundColor: "#d6efeb",
      fillStyle: "solid",
      opacity: 55,
      customData: businessData("reference-region", {
        referenceId: "demo-reference-001",
        sourceElementIds: ["poc-image"],
      }),
    },
    {
      id: "poc-reference-label",
      type: "text",
      x: 710,
      y: 500,
      text: "区域参考\n选中后交给生成链路",
      fontSize: 22,
      strokeColor: "#155b58",
      customData: businessData("reference-region-label", {
        referenceId: "demo-reference-001",
      }),
    },
  ])

  return {
    elements,
    appState: { viewBackgroundColor: "#fbf7ef" },
    files: imageFiles,
  }
}

function downloadJson(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }))
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  window.setTimeout(() => {
    link.remove()
    URL.revokeObjectURL(url)
  }, 0)
}

function App() {
  const initialScene = useMemo(() => makeInitialScene(), [])
  const uiOptions = useMemo(() => ({ canvasActions: { loadScene: false, saveToActiveFile: false } }), [])
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null)
  const [scene, setScene] = useState<SceneState>(initialScene)
  const [event, setEvent] = useState("等待 Excalidraw 初始化")
  const handleChange = useCallback((elements: readonly ExcalidrawElement[], appState: Record<string, unknown>, files: BinaryFiles) => {
    setScene({ elements, appState, files })
  }, [])

  const selectedBusinessData = useMemo(() => {
    if (!api) return null
    const selectedId = Object.entries(api.getAppState().selectedElementIds).find(([, selected]) => selected)?.[0]
    const selected = api.getSceneElements().find((element) => element.id === selectedId)
    return selected?.customData ?? null
  }, [api, scene])

  const addElements = (kind: "generation-result" | "agent-plan") => {
    if (!api) return
    const current = api.getSceneElements()
    const next = convertToExcalidrawElements(
      kind === "generation-result"
        ? [
            {
              type: "rectangle",
              x: 560,
              y: 330,
              width: 300,
              height: 90,
              strokeColor: "#bb6d49",
              backgroundColor: "#f2c7ae",
              fillStyle: "solid",
              customData: businessData("generation-result", {
                generationId: `demo-generation-${Date.now()}`,
                status: "ready",
              }),
            },
            {
              type: "text",
              x: 600,
              y: 360,
              text: "生成结果已插入",
              fontSize: 22,
              strokeColor: "#6f4e40",
              customData: businessData("generation-result-label"),
            },
          ]
        : [
            {
              type: "rectangle",
              x: 80,
              y: 690,
              width: 520,
              height: 140,
              strokeColor: "#177f7a",
              backgroundColor: "#e2f1ee",
              fillStyle: "solid",
              customData: businessData("agent-plan", {
                planId: `demo-plan-${Date.now()}`,
                status: "draft",
              }),
            },
            {
              type: "text",
              x: 115,
              y: 735,
              text: "新 Agent 计划（详情在外部面板）",
              fontSize: 22,
              strokeColor: "#155b58",
              customData: businessData("agent-plan-label"),
            },
          ],
      { regenerateIds: true },
    )
    api.updateScene({
      elements: [...current, ...next],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    })
    setEvent(`已插入 ${kind === "generation-result" ? "生成结果" : "Agent 计划"}`)
  }

  const restoreRoundTrip = () => {
    if (!api) return
    const current = {
      elements: api.getSceneElements(),
      appState: api.getAppState(),
      files: api.getFiles(),
    }
    const restored = restore(current, {}, null)
    api.addFiles(Object.values(restored.files))
    api.updateScene({
      elements: restored.elements,
      appState: restored.appState,
      captureUpdate: CaptureUpdateAction.NEVER,
    })
    setEvent(`restore/重新加载闭环通过：${restored.elements.length} 个元素，${Object.keys(restored.files).length} 个文件`)
  }

  const resetScene = () => {
    if (!api) return
    const next = makeInitialScene()
    api.addFiles(Object.values(next.files))
    api.updateScene({
      elements: next.elements,
      appState: next.appState,
      captureUpdate: CaptureUpdateAction.NEVER,
    })
    api.scrollToContent(next.elements)
    setEvent("已恢复代表性场景")
  }

  return (
    <main className="poc-shell">
      <header className="poc-header">
        <div>
          <p className="eyebrow">PROTOTYPE · NOT PRODUCTION</p>
          <h1>AI Cove × Excalidraw</h1>
          <p className="subtitle">验证元素、图片 files、customData、外部 Agent 操作和区域参考的最小闭环。</p>
        </div>
        <div className="status-pill">{event}</div>
      </header>
      <section className="poc-workspace">
        <div className="poc-canvas">
          <Excalidraw
            initialData={initialScene}
            excalidrawAPI={setApi}
            onChange={handleChange}
            UIOptions={uiOptions}
          />
        </div>
        <aside className="poc-panel">
          <div className="panel-section">
            <h2>外部操作面板</h2>
            <button onClick={() => addElements("generation-result")}>插入生成结果</button>
            <button onClick={() => addElements("agent-plan")}>插入 Agent 计划</button>
            <button onClick={() => api?.setActiveTool({ type: "rectangle" })}>进入区域参考绘制</button>
            <button onClick={restoreRoundTrip}>执行 restore / 重新加载</button>
            <button onClick={() => api && downloadJson("excalidraw-poc.json", serializeAsJSON(api.getSceneElements(), api.getAppState(), api.getFiles(), "local"))}>导出场景 JSON</button>
            <button onClick={resetScene}>恢复代表性场景</button>
          </div>
          <div className="panel-section panel-readout">
            <h2>当前状态</h2>
            <dl>
              <div><dt>元素</dt><dd>{scene.elements.length}</dd></div>
              <div><dt>图片文件</dt><dd>{Object.keys(scene.files).length}</dd></div>
              <div><dt>运行时</dt><dd>{api ? "ready" : "loading"}</dd></div>
            </dl>
            <p className="hint">点击画布中的 Agent 计划或区域参考元素，查看 customData 是否能被外部面板读取。</p>
            <pre>{JSON.stringify(selectedBusinessData, null, 2)}</pre>
          </div>
        </aside>
      </section>
    </main>
  )
}

createRoot(document.getElementById("root")!).render(<App />)
