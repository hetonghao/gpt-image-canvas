import type { MaskedSecret } from "./provider-config.js";

export const REGION_SUMMARY_LOCALES = ["zh-CN", "en"] as const;
export type RegionSummaryLocale = (typeof REGION_SUMMARY_LOCALES)[number];

export const REGION_SUMMARY_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp"] as const;
export type RegionSummaryImageMimeType = (typeof REGION_SUMMARY_IMAGE_MIME_TYPES)[number];

export const MAX_REGION_SUMMARY_IMAGE_BYTES = 50 * 1024 * 1024;

export interface SummaryLlmConfigView {
  configured: boolean;
  apiKey: MaskedSecret;
  apiKeyId?: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  supportsVision: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SaveSummaryLlmConfigRequest {
  apiKey?: string;
  apiKeyId?: string;
  preserveApiKey?: boolean;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  supportsVision: boolean;
}

export interface NormalizedImageRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RegionSummaryImageInput {
  dataUrl: string;
  fileName?: string;
}

export interface RegionSummaryRequest {
  image: RegionSummaryImageInput;
  source: {
    width: number;
    height: number;
  };
  region: NormalizedImageRegion;
  locale?: RegionSummaryLocale;
}

export interface RegionSummaryResponse {
  label: string;
  description: string;
}
