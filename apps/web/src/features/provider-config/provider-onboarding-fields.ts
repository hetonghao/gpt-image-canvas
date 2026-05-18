export type OnboardingFieldState = "filled" | "missing";

export interface OnboardingRequiredFields {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface OnboardingProviderFields {
  agent: OnboardingRequiredFields;
  image: OnboardingRequiredFields;
}

export type OnboardingRequiredFieldStates = Record<keyof OnboardingRequiredFields, OnboardingFieldState>;
export type OnboardingProviderFieldStates = Record<keyof OnboardingProviderFields, OnboardingRequiredFieldStates>;

export function onboardingFieldState(value: string): OnboardingFieldState {
  return value.trim() ? "filled" : "missing";
}

export function onboardingRequiredFieldStates(fields: OnboardingRequiredFields): OnboardingRequiredFieldStates {
  return {
    apiKey: onboardingFieldState(fields.apiKey),
    baseUrl: onboardingFieldState(fields.baseUrl),
    model: onboardingFieldState(fields.model)
  };
}

export function onboardingProviderFieldStates(fields: OnboardingProviderFields): OnboardingProviderFieldStates {
  return {
    agent: onboardingRequiredFieldStates(fields.agent),
    image: onboardingRequiredFieldStates(fields.image)
  };
}
