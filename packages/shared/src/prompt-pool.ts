export type PromptPoolMediaType = "image" | "video";
export type PromptPoolErrorCode = "prompt_pool_missing" | "prompt_pool_invalid" | "prompt_pool_item_not_found";
export type PromptPoolSortMode = "latest" | "popular" | "ready";

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

export interface PromptPoolListItem extends Omit<PromptPoolItem, "prompt"> {
  promptExcerpt: string;
  promptLength: number;
}

export interface PromptPoolModelOption {
  count: number;
  model: string;
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
  items: PromptPoolListItem[];
  limit: number;
  modelOptions: PromptPoolModelOption[];
  nextOffset: number | null;
  offset: number;
  readyCount: number;
  summary: PromptPoolSummary;
  totalCount: number;
  errorCode?: PromptPoolErrorCode;
}

export interface PromptPoolItemResponse {
  available: boolean;
  item?: PromptPoolItem;
  errorCode?: PromptPoolErrorCode;
}
