import { useI18n } from "../i18n";
import type { DesktopUpdateDialogState } from "./desktop-updater";

type DesktopUpdateDialogProps = {
  state: DesktopUpdateDialogState;
  onClose: () => void;
  onDownload: () => void;
  onInstall: () => void;
};

function formatPublishedAt(value: string | null, locale: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function DesktopUpdateDialog({ state, onClose, onDownload, onInstall }: DesktopUpdateDialogProps) {
  const { locale, t } = useI18n();
  if (!state.isOpen) return null;

  const publishedAt = formatPublishedAt(state.publishedAt, locale);
  const isBusy = state.status === "checking" || state.status === "downloading";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/45 px-4 py-6" role="presentation">
      <section
        aria-labelledby="desktop-update-title"
        aria-modal="true"
        className="w-full max-w-md rounded-lg border border-neutral-200 bg-white p-5 text-neutral-900 shadow-2xl shadow-neutral-950/20"
        role="dialog"
      >
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-cyan-700">{t("desktopUpdateKicker")}</p>
          <h2 id="desktop-update-title" className="text-lg font-semibold">
            {state.message ?? t("desktopUpdateTitle")}
          </h2>
          {state.currentVersion ? <p className="text-sm text-neutral-500">{t("desktopUpdateCurrentVersion", { version: state.currentVersion })}</p> : null}
          {state.availableVersion ? <p className="text-sm text-neutral-500">{t("desktopUpdateAvailableVersion", { version: state.availableVersion })}</p> : null}
          {publishedAt ? <p className="text-sm text-neutral-500">{t("desktopUpdatePublishedAt", { publishedAt })}</p> : null}
          {state.notes ? <p className="rounded-lg bg-neutral-50 p-3 text-sm leading-6 text-neutral-700">{state.notes}</p> : null}
          {state.error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
              {state.error}
            </p>
          ) : null}
          {typeof state.progressPercent === "number" && (state.status === "downloading" || state.status === "downloaded" || state.status === "installed") ? (
            <div className="space-y-1">
              <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
                <span className="block h-full rounded-full bg-cyan-600" style={{ width: `${state.progressPercent}%` }} />
              </div>
              <p className="text-xs text-neutral-500">{state.progressPercent}%</p>
            </div>
          ) : null}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          {!isBusy ? (
            <button className="rounded-md border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50" type="button" onClick={onClose}>
              {t("desktopUpdateLater")}
            </button>
          ) : null}
          {state.status === "available" ? (
            <button className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-semibold text-white hover:bg-neutral-800" type="button" onClick={onDownload}>
              {t("desktopUpdateDownload")}
            </button>
          ) : null}
          {state.status === "downloaded" ? (
            <button className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-semibold text-white hover:bg-neutral-800" type="button" onClick={onInstall}>
              {t("desktopUpdateInstall")}
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
