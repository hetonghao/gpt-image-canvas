import { and, asc, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type {
  CreatePromptFavoriteGroupRequest,
  CreatePromptFavoriteRequest,
  PromptFavoriteGroup,
  PromptFavoriteItem,
  PromptFavoritesResponse,
  UpdatePromptFavoriteGroupRequest,
  UpdatePromptFavoriteRequest
} from "../contracts.js";
import { db } from "../../infrastructure/database.js";
import { promptFavoriteGroups, promptFavorites } from "../../infrastructure/schema.js";
import { getPromptPool } from "../prompt-pool/prompt-pool.js";

const DEFAULT_GROUP_ID = "default";
const DEFAULT_GROUP_NAME = "常用";
const MAX_GROUP_NAME_LENGTH = 32;

export class PromptFavoriteError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}

export function listPromptFavorites(): PromptFavoritesResponse {
  ensureDefaultGroup();
  return {
    groups: db
      .select()
      .from(promptFavoriteGroups)
      .orderBy(asc(promptFavoriteGroups.sortOrder), asc(promptFavoriteGroups.createdAt))
      .all()
      .map(toPromptFavoriteGroup),
    favorites: db
      .select()
      .from(promptFavorites)
      .orderBy(desc(promptFavorites.lastUsedAt), desc(promptFavorites.updatedAt), desc(promptFavorites.createdAt))
      .all()
      .map(toPromptFavoriteItem)
  };
}

export async function createPromptFavorite(input: CreatePromptFavoriteRequest): Promise<PromptFavoriteItem> {
  const promptPoolItemId = normalizeId(input.promptPoolItemId);
  if (!promptPoolItemId) {
    throw new PromptFavoriteError("invalid_prompt_favorite", "Prompt pool item id is required.");
  }

  const groupId = normalizeGroupId(input.groupId) ?? DEFAULT_GROUP_ID;
  const group = getPromptFavoriteGroupRow(groupId);
  if (!group) {
    throw new PromptFavoriteError("prompt_favorite_group_not_found", "Prompt favorite group was not found.", 404);
  }

  const pool = await getPromptPool();
  const item = pool.items.find((candidate) => candidate.id === promptPoolItemId);
  if (!item) {
    throw new PromptFavoriteError("prompt_pool_item_not_found", "Prompt pool item was not found.", 404);
  }

  const existing = getPromptFavoriteBySource("pool", item.id);
  const now = nowIso();
  if (existing) {
    db.update(promptFavorites)
      .set({
        groupId,
        title: item.title,
        prompt: item.prompt,
        model: item.model,
        mediaType: item.mediaType,
        assetUrl: item.assetUrl,
        imageWidth: item.imageWidth ?? null,
        imageHeight: item.imageHeight ?? null,
        sourceUrl: item.sourceUrl ?? null,
        updatedAt: now
      })
      .where(eq(promptFavorites.id, existing.id))
      .run();
    return getPromptFavoriteById(existing.id) ?? toPromptFavoriteItem(existing);
  }

  const id = `favorite-${randomUUID()}`;
  db.insert(promptFavorites)
    .values({
      id,
      sourceType: "pool",
      sourceId: item.id,
      groupId,
      title: item.title,
      prompt: item.prompt,
      model: item.model,
      mediaType: item.mediaType,
      assetUrl: item.assetUrl,
      imageWidth: item.imageWidth ?? null,
      imageHeight: item.imageHeight ?? null,
      sourceUrl: item.sourceUrl ?? null,
      useCount: 0,
      lastUsedAt: null,
      createdAt: now,
      updatedAt: now
    })
    .run();

  return getPromptFavoriteById(id) ?? {
    id,
    sourceType: "pool",
    sourceId: item.id,
    groupId,
    title: item.title,
    prompt: item.prompt,
    model: item.model,
    mediaType: item.mediaType,
    assetUrl: item.assetUrl,
    imageWidth: item.imageWidth,
    imageHeight: item.imageHeight,
    sourceUrl: item.sourceUrl,
    useCount: 0,
    createdAt: now,
    updatedAt: now
  };
}

export function updatePromptFavorite(favoriteId: string, input: UpdatePromptFavoriteRequest): PromptFavoriteItem {
  const id = normalizeId(favoriteId);
  if (!id) {
    throw new PromptFavoriteError("prompt_favorite_not_found", "Prompt favorite was not found.", 404);
  }

  const existing = getPromptFavoriteById(id);
  if (!existing) {
    throw new PromptFavoriteError("prompt_favorite_not_found", "Prompt favorite was not found.", 404);
  }

  const groupId = normalizeGroupId(input.groupId);
  if (!groupId || !getPromptFavoriteGroupRow(groupId)) {
    throw new PromptFavoriteError("prompt_favorite_group_not_found", "Prompt favorite group was not found.", 404);
  }

  db.update(promptFavorites)
    .set({
      groupId,
      updatedAt: nowIso()
    })
    .where(eq(promptFavorites.id, id))
    .run();

  return getPromptFavoriteById(id) ?? existing;
}

export function deletePromptFavorite(favoriteId: string): void {
  const id = normalizeId(favoriteId);
  if (!id || !getPromptFavoriteById(id)) {
    throw new PromptFavoriteError("prompt_favorite_not_found", "Prompt favorite was not found.", 404);
  }

  db.delete(promptFavorites).where(eq(promptFavorites.id, id)).run();
}

export function markPromptFavoriteUsed(favoriteId: string): PromptFavoriteItem {
  const id = normalizeId(favoriteId);
  const existing = id ? getPromptFavoriteById(id) : undefined;
  if (!existing) {
    throw new PromptFavoriteError("prompt_favorite_not_found", "Prompt favorite was not found.", 404);
  }

  const now = nowIso();
  db.update(promptFavorites)
    .set({
      useCount: existing.useCount + 1,
      lastUsedAt: now,
      updatedAt: now
    })
    .where(eq(promptFavorites.id, existing.id))
    .run();

  return getPromptFavoriteById(existing.id) ?? {
    ...existing,
    useCount: existing.useCount + 1,
    lastUsedAt: now,
    updatedAt: now
  };
}

export function createPromptFavoriteGroup(input: CreatePromptFavoriteGroupRequest): PromptFavoriteGroup {
  const name = normalizeGroupName(input.name);
  if (!name) {
    throw new PromptFavoriteError("invalid_prompt_favorite_group", "Prompt favorite group name is required.");
  }

  const existing = getPromptFavoriteGroups().find((group) => group.name === name);
  if (existing) {
    return toPromptFavoriteGroup(existing);
  }

  const now = nowIso();
  const id = `group-${randomUUID()}`;
  const sortOrder = nextGroupSortOrder();
  db.insert(promptFavoriteGroups)
    .values({
      id,
      name,
      sortOrder,
      createdAt: now,
      updatedAt: now
    })
    .run();

  return getPromptFavoriteGroup(id) ?? {
    id,
    name,
    sortOrder,
    isDefault: false,
    createdAt: now,
    updatedAt: now
  };
}

export function updatePromptFavoriteGroup(groupIdValue: string, input: UpdatePromptFavoriteGroupRequest): PromptFavoriteGroup {
  const groupId = normalizeGroupId(groupIdValue);
  if (!groupId) {
    throw new PromptFavoriteError("prompt_favorite_group_not_found", "Prompt favorite group was not found.", 404);
  }

  const existing = getPromptFavoriteGroupRow(groupId);
  if (!existing) {
    throw new PromptFavoriteError("prompt_favorite_group_not_found", "Prompt favorite group was not found.", 404);
  }

  const name = normalizeGroupName(input.name);
  if (!name) {
    throw new PromptFavoriteError("invalid_prompt_favorite_group", "Prompt favorite group name is required.");
  }

  db.update(promptFavoriteGroups)
    .set({
      name,
      updatedAt: nowIso()
    })
    .where(eq(promptFavoriteGroups.id, groupId))
    .run();

  return getPromptFavoriteGroup(groupId) ?? toPromptFavoriteGroup(existing);
}

export function deletePromptFavoriteGroup(groupIdValue: string): void {
  const groupId = normalizeGroupId(groupIdValue);
  if (!groupId) {
    throw new PromptFavoriteError("prompt_favorite_group_not_found", "Prompt favorite group was not found.", 404);
  }

  const existing = getPromptFavoriteGroupRow(groupId);
  if (!existing) {
    throw new PromptFavoriteError("prompt_favorite_group_not_found", "Prompt favorite group was not found.", 404);
  }

  if (groupId === DEFAULT_GROUP_ID) {
    throw new PromptFavoriteError("prompt_favorite_default_group", "The default prompt favorite group cannot be deleted.");
  }

  ensureDefaultGroup();
  const now = nowIso();
  db.update(promptFavorites)
    .set({
      groupId: DEFAULT_GROUP_ID,
      updatedAt: now
    })
    .where(eq(promptFavorites.groupId, groupId))
    .run();
  db.delete(promptFavoriteGroups).where(eq(promptFavoriteGroups.id, groupId)).run();
}

function ensureDefaultGroup(): void {
  if (getPromptFavoriteGroupRow(DEFAULT_GROUP_ID)) {
    return;
  }

  const now = nowIso();
  db.insert(promptFavoriteGroups)
    .values({
      id: DEFAULT_GROUP_ID,
      name: DEFAULT_GROUP_NAME,
      sortOrder: 0,
      createdAt: now,
      updatedAt: now
    })
    .run();
}

function getPromptFavoriteById(id: string): PromptFavoriteItem | undefined {
  const row = db.select().from(promptFavorites).where(eq(promptFavorites.id, id)).get();
  return row ? toPromptFavoriteItem(row) : undefined;
}

function getPromptFavoriteBySource(sourceType: "pool", sourceId: string): (typeof promptFavorites.$inferSelect) | undefined {
  return db
    .select()
    .from(promptFavorites)
    .where(and(eq(promptFavorites.sourceType, sourceType), eq(promptFavorites.sourceId, sourceId)))
    .get();
}

function getPromptFavoriteGroup(id: string): PromptFavoriteGroup | undefined {
  const row = getPromptFavoriteGroupRow(id);
  return row ? toPromptFavoriteGroup(row) : undefined;
}

function getPromptFavoriteGroupRow(id: string): (typeof promptFavoriteGroups.$inferSelect) | undefined {
  return db.select().from(promptFavoriteGroups).where(eq(promptFavoriteGroups.id, id)).get();
}

function getPromptFavoriteGroups(): Array<typeof promptFavoriteGroups.$inferSelect> {
  ensureDefaultGroup();
  return db.select().from(promptFavoriteGroups).orderBy(asc(promptFavoriteGroups.sortOrder)).all();
}

function nextGroupSortOrder(): number {
  const groups = getPromptFavoriteGroups();
  return Math.max(0, ...groups.map((group) => group.sortOrder)) + 100;
}

function toPromptFavoriteGroup(row: typeof promptFavoriteGroups.$inferSelect): PromptFavoriteGroup {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sortOrder,
    isDefault: row.id === DEFAULT_GROUP_ID,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function toPromptFavoriteItem(row: typeof promptFavorites.$inferSelect): PromptFavoriteItem {
  return {
    id: row.id,
    sourceType: "pool",
    sourceId: row.sourceId,
    groupId: row.groupId,
    title: row.title,
    prompt: row.prompt,
    model: row.model,
    mediaType: row.mediaType === "video" ? "video" : "image",
    assetUrl: row.assetUrl,
    imageWidth: row.imageWidth ?? undefined,
    imageHeight: row.imageHeight ?? undefined,
    sourceUrl: row.sourceUrl ?? undefined,
    useCount: row.useCount,
    lastUsedAt: row.lastUsedAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function normalizeGroupName(value: string | undefined): string | undefined {
  const name = value?.trim().replace(/\s+/gu, " ");
  return name ? name.slice(0, MAX_GROUP_NAME_LENGTH) : undefined;
}

function normalizeGroupId(value: string | undefined): string | undefined {
  return normalizeId(value);
}

function normalizeId(value: string | undefined): string | undefined {
  const id = value?.trim();
  return id && /^[a-zA-Z0-9:_-]{1,160}$/u.test(id) ? id : undefined;
}

function nowIso(): string {
  return new Date().toISOString();
}
