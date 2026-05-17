export type HostAdapterMode = "standalone" | "ai-cove";

export interface HostUser {
  id: string;
  displayName: string;
  email?: string;
}

export interface HostApiKeySummary {
  id: string;
  name: string;
  status?: string;
  group?: string;
  quota?: {
    total?: number;
    used?: number;
    remaining?: number;
  };
  maskedKey?: string;
}

export interface HostSessionResponse {
  adapter: {
    mode: HostAdapterMode;
    aiCoveApiBaseUrl: string;
    gatewayBaseUrl: string;
  };
  user: HostUser;
}

export interface HostApiKeysResponse {
  items: HostApiKeySummary[];
}

export interface HostModelSummary {
  id: string;
}

export interface HostModelsResponse {
  items: HostModelSummary[];
}
