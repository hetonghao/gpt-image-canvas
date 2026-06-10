import { useMemo, useRef, useState } from "react";

import {
  desktopUpdateProgressFromBytes,
  desktopUpdaterAdapter,
  desktopUpdaterDialogState,
  desktopUpdaterErrorMessage,
  initialDesktopUpdaterState,
  type DesktopUpdateDownloadEvent,
  type DesktopUpdaterAdapter,
  type DesktopUpdaterState
} from "./desktop-updater";

export type UseDesktopUpdaterOptions = {
  adapter?: DesktopUpdaterAdapter;
};

export function useDesktopUpdater(options: UseDesktopUpdaterOptions = {}) {
  const adapter = useMemo(() => options.adapter ?? desktopUpdaterAdapter, [options.adapter]);
  const isSupported = adapter.isSupported();
  const downloadInFlightRef = useRef<Promise<void> | null>(null);
  const [state, setState] = useState<DesktopUpdaterState>(() =>
    isSupported ? initialDesktopUpdaterState : { ...initialDesktopUpdaterState, status: "unsupported" }
  );

  const checkForUpdates = async () => {
    if (!isSupported) {
      setState((current) => ({ ...current, status: "unsupported", message: null, error: null }));
      return;
    }

    setState((current) => ({
      ...current,
      status: "checking",
      message: "正在检查更新...",
      error: null
    }));

    try {
      const [currentVersion, availableUpdate] = await Promise.all([adapter.getCurrentVersion(), adapter.check()]);

      setState((current) =>
        availableUpdate
          ? {
              ...current,
              status: "available",
              currentVersion,
              availableUpdate,
              progress: null,
              message: `发现新版本 ${availableUpdate.version}`,
              error: null,
              isDialogOpen: true
            }
          : {
              ...current,
              status: "up-to-date",
              currentVersion,
              availableUpdate: null,
              progress: null,
              message: "当前已是最新版本",
              error: null,
              isDialogOpen: true
            }
      );
    } catch (error) {
      setState((current) => ({
        ...current,
        status: "error",
        progress: null,
        error: desktopUpdaterErrorMessage(error, "检查更新失败，请稍后重试"),
        message: null,
        isDialogOpen: true
      }));
    }
  };

  const closeDialog = () => {
    setState((current) => ({
      ...current,
      isDialogOpen: false
    }));
  };

  const downloadUpdate = () => {
    if (downloadInFlightRef.current) return downloadInFlightRef.current;
    const availableUpdate = state.availableUpdate;
    if (!availableUpdate) return undefined;

    let downloadedBytes = 0;
    let totalBytes: number | null = null;
    const downloadTask = (async () => {
      setState((current) => ({
        ...current,
        status: "downloading",
        progress: desktopUpdateProgressFromBytes(0, null),
        message: "正在下载更新包...",
        error: null,
        isDialogOpen: true
      }));

      try {
        await availableUpdate.download((event: DesktopUpdateDownloadEvent) => {
          if (event.event === "Started") {
            totalBytes = typeof event.data.contentLength === "number" && Number.isFinite(event.data.contentLength) ? event.data.contentLength : null;
          }
          if (event.event === "Progress") {
            downloadedBytes += event.data.chunkLength;
          }
          if (event.event === "Finished" && totalBytes !== null) {
            downloadedBytes = totalBytes;
          }

          setState((current) => ({
            ...current,
            progress: desktopUpdateProgressFromBytes(downloadedBytes, totalBytes)
          }));
        });

        setState((current) => ({
          ...current,
          status: "downloaded",
          progress: desktopUpdateProgressFromBytes(downloadedBytes, totalBytes ?? downloadedBytes),
          message: "更新包已准备完成，请安装并重启应用。",
          error: null,
          isDialogOpen: true
        }));
      } catch (error) {
        setState((current) => ({
          ...current,
          status: "error",
          error: desktopUpdaterErrorMessage(error, "下载更新失败，请稍后重试"),
          message: null,
          isDialogOpen: true
        }));
      } finally {
        downloadInFlightRef.current = null;
      }
    })();

    downloadInFlightRef.current = downloadTask;
    return downloadTask;
  };

  const installUpdate = async () => {
    const availableUpdate = state.availableUpdate;
    if (!availableUpdate) return;

    setState((current) => ({
      ...current,
      message: "正在安装更新...",
      error: null,
      isDialogOpen: true
    }));

    try {
      await adapter.prepareRelaunch();
      await availableUpdate.install();
      setState((current) => ({
        ...current,
        status: "installed",
        progress: current.progress ? { ...current.progress, percent: 100 } : desktopUpdateProgressFromBytes(0, 0),
        message: "更新已安装，正在重启应用...",
        error: null,
        isDialogOpen: true
      }));
      await adapter.relaunch();
    } catch (error) {
      setState((current) => ({
        ...current,
        status: "error",
        error: desktopUpdaterErrorMessage(error, "安装更新失败，请稍后重试"),
        message: null,
        isDialogOpen: true
      }));
    }
  };

  return {
    isSupported,
    state,
    dialogState: desktopUpdaterDialogState(state),
    checkForUpdates,
    closeDialog,
    downloadUpdate,
    installUpdate
  };
}
