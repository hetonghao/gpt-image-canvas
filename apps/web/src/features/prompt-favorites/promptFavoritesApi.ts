import type {
  CreatePromptFavoriteGroupRequest,
  CreatePromptFavoriteRequest,
  PromptFavoriteGroup,
  PromptFavoriteItem,
  PromptFavoritesResponse,
  UpdatePromptFavoriteGroupRequest,
  UpdatePromptFavoriteRequest
} from "@gpt-image-canvas/shared";

export async function fetchPromptFavorites(signal?: AbortSignal): Promise<PromptFavoritesResponse> {
  const response = await fetch("/api/prompt-favorites", { signal });
  return parseJsonResponse<PromptFavoritesResponse>(response);
}

export async function createPromptFavorite(input: CreatePromptFavoriteRequest): Promise<PromptFavoriteItem> {
  const response = await fetch("/api/prompt-favorites", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });
  return (await parseJsonResponse<{ favorite: PromptFavoriteItem }>(response)).favorite;
}

export async function updatePromptFavorite(favoriteId: string, input: UpdatePromptFavoriteRequest): Promise<PromptFavoriteItem> {
  const response = await fetch(`/api/prompt-favorites/${encodeURIComponent(favoriteId)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });
  return (await parseJsonResponse<{ favorite: PromptFavoriteItem }>(response)).favorite;
}

export async function deletePromptFavorite(favoriteId: string): Promise<void> {
  const response = await fetch(`/api/prompt-favorites/${encodeURIComponent(favoriteId)}`, {
    method: "DELETE"
  });
  await parseJsonResponse<{ ok: boolean }>(response);
}

export async function markPromptFavoriteUsed(favoriteId: string): Promise<PromptFavoriteItem> {
  const response = await fetch(`/api/prompt-favorites/${encodeURIComponent(favoriteId)}/use`, {
    method: "POST"
  });
  return (await parseJsonResponse<{ favorite: PromptFavoriteItem }>(response)).favorite;
}

export async function createPromptFavoriteGroup(input: CreatePromptFavoriteGroupRequest): Promise<PromptFavoriteGroup> {
  const response = await fetch("/api/prompt-favorite-groups", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });
  return (await parseJsonResponse<{ group: PromptFavoriteGroup }>(response)).group;
}

export async function updatePromptFavoriteGroup(groupId: string, input: UpdatePromptFavoriteGroupRequest): Promise<PromptFavoriteGroup> {
  const response = await fetch(`/api/prompt-favorite-groups/${encodeURIComponent(groupId)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });
  return (await parseJsonResponse<{ group: PromptFavoriteGroup }>(response)).group;
}

export async function deletePromptFavoriteGroup(groupId: string): Promise<void> {
  const response = await fetch(`/api/prompt-favorite-groups/${encodeURIComponent(groupId)}`, {
    method: "DELETE"
  });
  await parseJsonResponse<{ ok: boolean }>(response);
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => undefined)) as T | { error?: { message?: string } } | undefined;
  if (!response.ok) {
    const message = typeof body === "object" && body && "error" in body ? body.error?.message : undefined;
    throw new Error(message || `Request failed with status ${response.status}.`);
  }

  return body as T;
}
