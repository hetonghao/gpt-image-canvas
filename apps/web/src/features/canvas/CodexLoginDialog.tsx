import type { CodexDeviceStartResponse } from "@gpt-image-canvas/shared";
import { Copy, ExternalLink, KeyRound, Loader2, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useI18n } from "../../shared/i18n";
import { useModalFocus } from "../../shared/ui/use-modal-focus";

export type CodexLoginStatus = "idle" | "starting" | "pending" | "authorized" | "expired" | "denied" | "error";

type CodexLoginDialogProps = {
  readonly device: CodexDeviceStartResponse | null;
  readonly message: string;
  readonly onClose: () => void;
  readonly onCopyCode: () => Promise<void>;
  readonly onRestart: () => Promise<void>;
  readonly status: CodexLoginStatus;
};

export function CodexLoginDialog({ device, message, onClose, onCopyCode, onRestart, status }: CodexLoginDialogProps) {
  const { formatDateTime, t } = useI18n();
  const dialogRef = useModalFocus<HTMLDivElement>(onClose);

  return createPortal(
    <div className="app-modal-backdrop fixed inset-0 z-[3000] flex items-center justify-center bg-neutral-950/45 px-4 py-6" data-testid="codex-login-dialog">
      <div
        aria-labelledby="codex-login-title"
        aria-modal="true"
        className="codex-login-dialog app-modal-surface"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="codex-login-dialog__header">
          <div className="min-w-0">
            <h2 id="codex-login-title">{t("codexLoginTitle")}</h2>
            <p>{t("codexLoginSubtitle")}</p>
          </div>
          <button aria-label={t("codexCloseLogin")} className="history-icon-action" type="button" onClick={onClose}>
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="codex-login-dialog__body">
          {status === "starting" ? (
            <div className="codex-login-dialog__status" role="status">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              {t("codexCreatingCode")}
            </div>
          ) : null}

          {device ? (
            <>
              <div className="codex-device-code" data-testid="codex-user-code">
                {device.userCode}
              </div>
              <div className="codex-login-dialog__actions">
                <a className="primary-action h-10" href={device.verificationUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-4" aria-hidden="true" />
                  {t("codexOpenLoginPage")}
                </a>
                <button className="secondary-action h-10" type="button" onClick={() => void onCopyCode()}>
                  <Copy className="size-4" aria-hidden="true" />
                  {t("codexCopyCode")}
                </button>
              </div>
              <p className="codex-login-dialog__hint">
                {t("codexCodeExpires", { time: formatExpiry(device.expiresAt, formatDateTime, t("timeFallback15Minutes")) })}
              </p>
            </>
          ) : null}

          {message ? (
            <p
              className={`codex-login-dialog__message codex-login-dialog__message--${status}`}
              data-testid="codex-login-message"
              role={status === "pending" || status === "authorized" ? "status" : "alert"}
            >
              {status === "pending" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              {message}
            </p>
          ) : null}

          {status === "expired" || status === "denied" || status === "error" ? (
            <button className="secondary-action h-10" type="button" onClick={() => void onRestart()}>
              <KeyRound className="size-4" aria-hidden="true" />
              {t("codexRestart")}
            </button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
}

function formatExpiry(
  value: string,
  formatDateTime: (value: string, options?: Intl.DateTimeFormatOptions) => string,
  fallback: string
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }
  return formatDateTime(value, { hour: "2-digit", minute: "2-digit" });
}
