import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

type BackgroundElementState = {
  readonly ariaHidden: string | null;
  readonly inert: boolean;
};

type ModalFocusOptions = {
  readonly resolveRestoreFocus?: () => HTMLElement | null;
};

type ModalEntry = {
  readonly dialog: HTMLElement;
  readonly modalRoot: HTMLElement;
  readonly options: ModalFocusOptions | undefined;
  readonly previousFocus: HTMLElement | null;
};

const modalStack: ModalEntry[] = [];
let backgroundStates: Map<HTMLElement, BackgroundElementState> | null = null;
let sessionEntry: ModalEntry | null = null;

export function useModalFocus<T extends HTMLElement>(onClose: () => void, options?: ModalFocusOptions): RefObject<T> {
  const ref = useRef<T>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) {
      return;
    }

    const entry: ModalEntry = {
      dialog,
      modalRoot: directBodyChild(dialog) ?? dialog,
      options,
      previousFocus: document.activeElement instanceof HTMLElement ? document.activeElement : null
    };
    if (modalStack.length === 0) {
      backgroundStates = new Map();
      sessionEntry = entry;
    }
    modalStack.push(entry);
    syncModalInteractivity();

    const frame = window.requestAnimationFrame(() => {
      (visibleFocusableElements(dialog)[0] ?? dialog).focus();
    });

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!isTopModal(dialog)) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusable = visibleFocusableElements(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        return;
      }

      const activeElement = document.activeElement;
      if (!(activeElement instanceof HTMLElement) || !dialog.contains(activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }

      if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const handleFocusIn = (event: FocusEvent): void => {
      if (!isTopModal(dialog)) {
        return;
      }

      const target = event.target;
      if (target instanceof HTMLElement && !dialog.contains(target)) {
        (visibleFocusableElements(dialog)[0] ?? dialog).focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("focusin", handleFocusIn, true);
    return () => {
      window.cancelAnimationFrame(frame);
      const wasTopModal = isTopModal(dialog);
      const entryIndex = modalStack.findIndex((candidate) => candidate.dialog === dialog);
      if (entryIndex >= 0) {
        modalStack.splice(entryIndex, 1);
      }
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("focusin", handleFocusIn, true);

      if (modalStack.length === 0) {
        const restoreEntry = sessionEntry ?? entry;
        restoreBackgroundInteractivity();
        sessionEntry = null;
        restoreFocus(() => resolveRestoreTarget(restoreEntry, dialog));
        return;
      }

      syncModalInteractivity();
      if (wasTopModal) {
        const nextTop = modalStack.at(-1);
        restoreFocus(() => resolveRestoreTarget(entry, dialog) ?? nextTop?.dialog);
      }
    };
  }, []);

  return ref;
}

function syncModalInteractivity(): void {
  if (!backgroundStates) {
    return;
  }
  rememberBodyChildren();
  const topRoot = modalStack.at(-1)?.modalRoot;
  for (const element of Array.from(document.body.children)) {
    if (!(element instanceof HTMLElement)) {
      continue;
    }
    if (element === topRoot) {
      restoreElementState(element);
    } else {
      element.inert = true;
      element.setAttribute("aria-hidden", "true");
    }
  }
}

function rememberBodyChildren(): void {
  if (!backgroundStates) {
    return;
  }
  for (const element of Array.from(document.body.children)) {
    if (element instanceof HTMLElement && !backgroundStates.has(element)) {
      backgroundStates.set(element, {
        ariaHidden: element.getAttribute("aria-hidden"),
        inert: element.inert
      });
    }
  }
}

function restoreBackgroundInteractivity(): void {
  if (!backgroundStates) {
    return;
  }
  for (const element of backgroundStates.keys()) {
    restoreElementState(element);
  }
  backgroundStates = null;
}

function restoreElementState(element: HTMLElement): void {
  const state = backgroundStates?.get(element);
  if (!state) {
    return;
  }
  element.inert = state.inert;
  if (state.ariaHidden === null) {
    element.removeAttribute("aria-hidden");
  } else {
    element.setAttribute("aria-hidden", state.ariaHidden);
  }
}

function directBodyChild(element: HTMLElement): HTMLElement | null {
  let current = element;
  while (current.parentElement && current.parentElement !== document.body) {
    current = current.parentElement;
  }
  return current.parentElement === document.body ? current : null;
}

function resolveRestoreTarget(entry: ModalEntry, closingDialog: HTMLElement): HTMLElement | null {
  const requested = entry.options?.resolveRestoreFocus?.();
  if (requested?.isConnected) {
    return requested;
  }
  if (entry.previousFocus?.isConnected) {
    return entry.previousFocus;
  }
  return Array.from(document.querySelectorAll<HTMLElement>(focusableSelector)).find(
    (element) => !closingDialog.contains(element) && !element.closest("[inert]") && element.getClientRects().length > 0
  ) ?? null;
}

function restoreFocus(resolveTarget: () => HTMLElement | null | undefined): void {
  let remainingAttempts = 3;
  const attempt = (): void => {
    const target = resolveTarget();
    if (!target?.isConnected) {
      return;
    }
    target.focus({ preventScroll: true });
    if (document.activeElement !== target && remainingAttempts > 0) {
      remainingAttempts -= 1;
      window.requestAnimationFrame(attempt);
    }
  };
  attempt();
}

function isTopModal(dialog: HTMLElement): boolean {
  return modalStack.at(-1)?.dialog === dialog;
}

function visibleFocusableElements(container: HTMLElement): readonly HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(focusableSelector)).filter(
    (element) => !element.closest("[inert]") && element.getClientRects().length > 0
  );
}
