const PROMPT_FAVORITES_INVALIDATION_EVENT = "gpt-image-canvas:prompt-favorites-invalidated";

type PromptFavoritesRefreshTask = (signal: AbortSignal) => Promise<void>;

export function emitPromptFavoritesInvalidation(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new Event(PROMPT_FAVORITES_INVALIDATION_EVENT));
}

export function subscribePromptFavoritesInvalidation(listener: () => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handleInvalidation = (): void => {
    listener();
  };

  window.addEventListener(PROMPT_FAVORITES_INVALIDATION_EVENT, handleInvalidation);
  return () => {
    window.removeEventListener(PROMPT_FAVORITES_INVALIDATION_EVENT, handleInvalidation);
  };
}

export function createPromptFavoritesRefreshController(task: PromptFavoritesRefreshTask) {
  let activeController: AbortController | null = null;

  return {
    async refresh(): Promise<void> {
      activeController?.abort();
      const controller = new AbortController();
      activeController = controller;

      try {
        await task(controller.signal);
      } finally {
        if (activeController === controller) {
          activeController = null;
        }
      }
    },
    dispose(): void {
      activeController?.abort();
      activeController = null;
    }
  };
}
