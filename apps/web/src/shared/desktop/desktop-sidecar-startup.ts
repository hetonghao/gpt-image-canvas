import { useEffect, useState } from "react";

import { isTauriRuntime } from "./desktop-runtime";

export const DESKTOP_SIDECAR_STARTUP_EVENT = "ai-cove-design://sidecar-startup";

export type DesktopSidecarStartupStatus = "unsupported" | "starting" | "ready" | "error";

export type DesktopSidecarStartupState = {
  status: DesktopSidecarStartupStatus;
  message: string | null;
};

type DesktopSidecarStartupEventPayload = {
  status?: DesktopSidecarStartupStatus;
  message?: string | null;
};

export function isDesktopSidecarOrigin(location: Pick<URL, "hostname" | "protocol">): boolean {
  const protocol = location.protocol.toLowerCase();
  if (protocol !== "http:" && protocol !== "https:") {
    return false;
  }

  const hostname = location.hostname.toLowerCase();
  return hostname === "127.0.0.1" || hostname === "localhost";
}

export function desktopSidecarStartupInitialState(input: {
  tauriRuntime: boolean;
  location: Pick<URL, "hostname" | "protocol">;
}): DesktopSidecarStartupState {
  if (!input.tauriRuntime) {
    return {
      status: "unsupported",
      message: null
    };
  }

  if (isDesktopSidecarOrigin(input.location)) {
    return {
      status: "ready",
      message: null
    };
  }

  return {
    status: "starting",
    message: "正在启动本地服务..."
  };
}

function normalizeDesktopSidecarStartupState(payload: DesktopSidecarStartupEventPayload): DesktopSidecarStartupState {
  if (payload.status === "ready") {
    return {
      status: "ready",
      message: null
    };
  }

  if (payload.status === "error") {
    return {
      status: "error",
      message: typeof payload.message === "string" && payload.message.trim() ? payload.message.trim() : "本地服务启动失败。"
    };
  }

  return {
    status: "starting",
    message: typeof payload.message === "string" && payload.message.trim() ? payload.message.trim() : "正在启动本地服务..."
  };
}

export function useDesktopSidecarStartup(): DesktopSidecarStartupState {
  const [state, setState] = useState<DesktopSidecarStartupState>(() =>
    desktopSidecarStartupInitialState({
      tauriRuntime: isTauriRuntime(),
      location: window.location
    })
  );

  useEffect(() => {
    if (state.status !== "starting") {
      return;
    }

    let active = true;
    let unlisten: (() => void) | null = null;

    void (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<DesktopSidecarStartupEventPayload>(DESKTOP_SIDECAR_STARTUP_EVENT, (event) => {
          if (!active) {
            return;
          }
          setState(normalizeDesktopSidecarStartupState(event.payload ?? {}));
        });
      } catch (error) {
        if (!active) {
          return;
        }
        setState({
          status: "error",
          message: error instanceof Error && error.message.trim() ? error.message.trim() : "本地服务启动失败。"
        });
      }
    })();

    return () => {
      active = false;
      unlisten?.();
    };
  }, [state.status]);

  return state;
}
