import type { RuntimeImageProvider } from "@gpt-image-canvas/shared";
import type { AppRoute } from "./runtime-route";

export type GenerationSubmitAction = "generate" | "configure-image-model";

export interface ProviderOnboardingState {
  authProvider: RuntimeImageProvider | null;
  dismissedInPageSession: boolean;
  isProviderConfigDialogOpen: boolean;
  isAuthLoading: boolean;
  route: AppRoute;
}

export interface GenerationSubmitActionState {
  authProvider: RuntimeImageProvider | null;
  isAuthLoading: boolean;
}

export function shouldAutoOpenProviderOnboarding(state: ProviderOnboardingState): boolean {
  return (
    state.route === "canvas" &&
    !state.isAuthLoading &&
    !state.isProviderConfigDialogOpen &&
    state.authProvider === "none" &&
    !state.dismissedInPageSession
  );
}

export function generationSubmitActionForProviderState(state: GenerationSubmitActionState): GenerationSubmitAction {
  if (!state.isAuthLoading && state.authProvider === "none") {
    return "configure-image-model";
  }

  return "generate";
}
