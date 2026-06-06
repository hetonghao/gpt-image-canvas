import type { PromptPoolMediaType } from "./prompt-pool.js";

export type PromptFavoriteSourceType = "pool";

export interface PromptFavoriteGroup {
  id: string;
  name: string;
  sortOrder: number;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PromptFavoriteItem {
  id: string;
  sourceType: PromptFavoriteSourceType;
  sourceId: string;
  groupId: string;
  title: string;
  prompt: string;
  model: string;
  mediaType: PromptPoolMediaType;
  assetUrl: string;
  imageWidth?: number;
  imageHeight?: number;
  sourceUrl?: string;
  useCount: number;
  lastUsedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PromptFavoritesResponse {
  groups: PromptFavoriteGroup[];
  favorites: PromptFavoriteItem[];
}

export interface CreatePromptFavoriteRequest {
  promptPoolItemId: string;
  groupId?: string;
}

export interface UpdatePromptFavoriteRequest {
  groupId: string;
}

export interface CreatePromptFavoriteGroupRequest {
  name: string;
}

export interface UpdatePromptFavoriteGroupRequest {
  name: string;
}
