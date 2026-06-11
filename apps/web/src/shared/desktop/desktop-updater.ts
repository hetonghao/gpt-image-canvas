import type { DownloadEvent as TauriDownloadEvent } from "@tauri-apps/plugin-updater";

import { isTauriRuntime } from "./desktop-runtime";

export type DesktopUpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "up-to-date"
  | "downloading"
  | "downloaded"
  | "installing"
  | "installed"
  | "error"
  | "unsupported";

export type DesktopUpdateProgress = {
  downloadedBytes: number;
  totalBytes: number | null;
  percent: number | null;
};

export type DesktopUpdateEntry = {
  version: string;
  notes: string | null;
  publishedAt: string | null;
  download: (onProgress: (event: DesktopUpdateDownloadEvent) => void) => Promise<void>;
  install: () => Promise<void>;
};

export type DesktopUpdateDownloadEvent =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

export type DesktopUpdaterState = {
  status: DesktopUpdateStatus;
  currentVersion: string | null;
  availableUpdate: DesktopUpdateEntry | null;
  progress: DesktopUpdateProgress | null;
  message: string | null;
  error: string | null;
  isDialogOpen: boolean;
};

export type DesktopUpdateDialogState = {
  status: DesktopUpdateStatus;
  currentVersion: string | null;
  availableVersion: string | null;
  notes: string | null;
  publishedAt: string | null;
  downloadedBytes: number | null;
  totalBytes: number | null;
  progressPercent: number | null;
  error: string | null;
  message: string | null;
  isOpen: boolean;
};

export type DesktopUpdaterAdapter = {
  isSupported: () => boolean;
  getCurrentVersion: () => Promise<string>;
  check: () => Promise<DesktopUpdateEntry | null>;
  prepareRelaunch: () => Promise<void>;
  relaunch: () => Promise<void>;
};

type TauriUpdate = {
  version: string;
  body?: string | null;
  date?: string | null;
  download: (onEvent?: (event: TauriDownloadEvent) => void) => Promise<void>;
  install: () => Promise<void>;
};

export const initialDesktopUpdaterState: DesktopUpdaterState = {
  status: "idle",
  currentVersion: null,
  availableUpdate: null,
  progress: null,
  message: null,
  error: null,
  isDialogOpen: false
};

let desktopRelaunchLoader: Promise<() => Promise<void>> | null = null;
let desktopPrepareUpdateInstallLoader: Promise<() => Promise<void>> | null = null;

async function loadDesktopRelaunch(): Promise<() => Promise<void>> {
  if (!isTauriRuntime()) {
    return async () => {};
  }

  desktopRelaunchLoader ??= import("@tauri-apps/plugin-process").then(({ relaunch }) => relaunch);
  return desktopRelaunchLoader;
}

async function loadDesktopPrepareUpdateInstall(): Promise<() => Promise<void>> {
  if (!isTauriRuntime()) {
    return async () => {};
  }

  desktopPrepareUpdateInstallLoader ??= import("@tauri-apps/api/core").then(({ invoke }) => () => invoke<void>("prepare_desktop_update_install"));
  return desktopPrepareUpdateInstallLoader;
}

export const desktopUpdaterAdapter: DesktopUpdaterAdapter = {
  isSupported() {
    return isTauriRuntime();
  },
  async getCurrentVersion() {
    if (!isTauriRuntime()) return "";
    const { getVersion } = await import("@tauri-apps/api/app");
    return getVersion();
  },
  async check() {
    if (!isTauriRuntime()) return null;

    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) return null;

    const tauriUpdate = update as unknown as TauriUpdate;
    return {
      version: tauriUpdate.version,
      notes: tauriUpdate.body ?? null,
      publishedAt: tauriUpdate.date ?? null,
      download: (onProgress) => tauriUpdate.download((event) => onProgress(event as DesktopUpdateDownloadEvent)),
      install: () => tauriUpdate.install()
    };
  },
  async prepareRelaunch() {
    await loadDesktopRelaunch();
    const prepareUpdateInstall = await loadDesktopPrepareUpdateInstall();
    await prepareUpdateInstall();
  },
  async relaunch() {
    const relaunch = await loadDesktopRelaunch();
    await relaunch();
  }
};

export function desktopUpdateProgressFromBytes(downloadedBytes: number, totalBytes: number | null): DesktopUpdateProgress {
  const percent = totalBytes && totalBytes > 0 ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : null;
  return {
    downloadedBytes,
    totalBytes,
    percent
  };
}

export function desktopUpdaterDialogState(state: DesktopUpdaterState): DesktopUpdateDialogState {
  return {
    status: state.status,
    currentVersion: state.currentVersion,
    availableVersion: state.availableUpdate?.version ?? null,
    notes: state.availableUpdate?.notes ?? null,
    publishedAt: state.availableUpdate?.publishedAt ?? null,
    downloadedBytes: state.progress?.downloadedBytes ?? null,
    totalBytes: state.progress?.totalBytes ?? null,
    progressPercent: state.progress?.percent ?? null,
    error: state.error,
    message: state.message,
    isOpen: state.isDialogOpen
  };
}

export function formatDesktopUpdateBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const digits = unitIndex === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 1;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

export function desktopUpdateProgressLabel(downloadedBytes: number | null, totalBytes: number | null): string | null {
  if (typeof downloadedBytes !== "number" || !Number.isFinite(downloadedBytes) || downloadedBytes <= 0) {
    return null;
  }

  if (typeof totalBytes === "number" && Number.isFinite(totalBytes) && totalBytes > 0) {
    return `${formatDesktopUpdateBytes(downloadedBytes)} / ${formatDesktopUpdateBytes(totalBytes)}`;
  }

  return formatDesktopUpdateBytes(downloadedBytes);
}

export function desktopUpdaterErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error instanceof Error && error.message.trim()) return error.message.trim();

  if (error && typeof error === "object") {
    const message = Reflect.get(error, "message");
    if (typeof message === "string" && message.trim()) return message.trim();

    const nestedError = Reflect.get(error, "error");
    if (typeof nestedError === "string" && nestedError.trim()) return nestedError.trim();
  }

  return fallback;
}
