import type { RuntimeImageProvider } from "@gpt-image-canvas/shared";

export interface ProviderOnboardingState {
  authProvider: RuntimeImageProvider | null;
  dismissedInPageSession: boolean;
  isProviderConfigDialogOpen: boolean;
  isAuthLoading: boolean;
  route: "home" | "canvas" | "gallery";
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
