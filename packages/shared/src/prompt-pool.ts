export type PromptPoolMediaType = "image" | "video";
export type PromptPoolErrorCode = "prompt_pool_missing" | "prompt_pool_invalid";

export interface PromptPoolAuthor {
  name: string;
  username?: string;
  verified: boolean;
  profileUrl?: string;
}

export interface PromptPoolStats {
  likes: number;
  views: number;
  retweets: number;
}

export interface PromptPoolItem {
  id: string;
  title: string;
  prompt: string;
  mediaType: PromptPoolMediaType;
  model: string;
  postedAt?: string;
  promptReady: boolean;
  assetUrl: string;
  imageCount: number;
  imageWidth?: number;
  imageHeight?: number;
  aspectRatio?: string;
  author?: PromptPoolAuthor;
  stats: PromptPoolStats;
  sourceUrl?: string;
}

export interface PromptPoolSummary {
  builtAt?: string;
  scrapedAt?: string;
  siteUrl?: string;
  promptCount: number;
  imagePromptCount: number;
  videoPromptCount: number;
  assetCount: number;
}

export interface PromptPoolResponse {
  available: boolean;
  items: PromptPoolItem[];
  summary: PromptPoolSummary;
  errorCode?: PromptPoolErrorCode;
}
