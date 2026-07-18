import {
  AlertTriangle,
  ArrowRight,
  Bookmark,
  BookmarkCheck,
  CheckCircle2,
  Copy,
  Eye,
  Heart,
  ImageIcon,
  ImageOff,
  Images,
  Loader2,
  Pencil,
  Plus,
  Repeat2,
  RotateCcw,
  Sparkles,
  Trash2,
  Video,
  WandSparkles,
  X
} from "lucide-react";
import type { CSSProperties } from "react";
import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type {
  PromptFavoriteGroup,
  PromptFavoriteItem,
  PromptPoolItem,
  PromptPoolItemResponse,
  PromptPoolListItem,
  PromptPoolMediaType,
  PromptPoolModelOption,
  PromptPoolResponse,
  PromptPoolSortMode
} from "@gpt-image-canvas/shared";
import { apiFetch, hasHostCredentials } from "../../shared/api/host-token";
import { isDesktopAuthSupported } from "../../shared/desktop/desktop-auth";
import { useI18n } from "../../shared/i18n";
import { SearchField } from "../../shared/ui/SearchField";
import { useModalFocus } from "../../shared/ui/use-modal-focus";
import {
  createPromptFavorite,
  createPromptFavoriteGroup,
  deletePromptFavorite,
  deletePromptFavoriteGroup,
  fetchPromptFavorites,
  updatePromptFavorite,
  updatePromptFavoriteGroup
} from "../prompt-favorites/promptFavoritesApi";
import { emitPromptFavoritesInvalidation } from "../prompt-favorites/prompt-favorites-sync";

interface PromptPoolPageProps {
  onUsePrompt: (item: PromptPoolItem) => void;
}

type PromptPoolMediaFilter = "all" | PromptPoolMediaType;

const INITIAL_VISIBLE_COUNT = 72;
const LOAD_MORE_COUNT = 72;

export function PromptPoolPage({ onUsePrompt }: PromptPoolPageProps) {
  const { locale, t } = useI18n();
  const [items, setItems] = useState<PromptPoolListItem[]>([]);
  const [summary, setSummary] = useState<PromptPoolResponse["summary"] | null>(null);
  const [query, setQuery] = useState("");
  const [mediaFilter, setMediaFilter] = useState<PromptPoolMediaFilter>("all");
  const [modelFilter, setModelFilter] = useState("all");
  const [sortMode, setSortMode] = useState<PromptPoolSortMode>("latest");
  const [modelOptions, setModelOptions] = useState<PromptPoolModelOption[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [readyCount, setReadyCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [pageError, setPageError] = useState("");
  const [operationError, setOperationError] = useState("");
  const [favoriteError, setFavoriteError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<PromptPoolItem | null>(null);
  const [favoriteGroups, setFavoriteGroups] = useState<PromptFavoriteGroup[]>([]);
  const [favoriteItems, setFavoriteItems] = useState<PromptFavoriteItem[]>([]);
  const [favoritePopoverSourceId, setFavoritePopoverSourceId] = useState<string | null>(null);
  const [favoriteGroupDraft, setFavoriteGroupDraft] = useState("");
  const [favoriteSparkSourceId, setFavoriteSparkSourceId] = useState<string | null>(null);
  const [lastFavoriteToastSourceId, setLastFavoriteToastSourceId] = useState<string | null>(null);
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [renameGroupDraft, setRenameGroupDraft] = useState("");
  const copiedTimerRef = useRef<number | undefined>();
  const statusTimerRef = useRef<number | undefined>();
  const favoriteSparkTimerRef = useRef<number | undefined>();
  const favoriteRequestGenerationRef = useRef(0);
  const hydratedItemsRef = useRef(new Map<string, PromptPoolItem>());
  const deferredQuery = useDeferredValue(query);
  const poolQueryKey = promptPoolSearchParams(deferredQuery, mediaFilter, modelFilter, sortMode).toString();
  const poolQueryKeyRef = useRef(poolQueryKey);
  poolQueryKeyRef.current = poolQueryKey;
  const numberFormat = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 1, notation: "compact" }), [locale]);
  const columnCount = usePromptPoolColumnCount();
  const canUseFavorites = !isDesktopAuthSupported() || hasHostCredentials();
  const favoriteIdentity = favoriteIdentityBoundary(canUseFavorites);

  useEffect(() => {
    const controller = new AbortController();

    async function loadPool(): Promise<void> {
      setIsLoading(true);
      setPageError("");
      setOperationError("");

      try {
        const body = await fetchPromptPoolPage(0, INITIAL_VISIBLE_COUNT, controller.signal);

        if (!controller.signal.aborted) {
          syncPromptPoolPage(body, false);
        }
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setPageError(loadError instanceof Error ? loadError.message : t("poolLoadFailed"));
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    void loadPool();

    return () => {
      controller.abort();
    };
  }, [deferredQuery, mediaFilter, modelFilter, sortMode, t]);

  useEffect(() => {
    return () => {
      window.clearTimeout(copiedTimerRef.current);
      window.clearTimeout(statusTimerRef.current);
      window.clearTimeout(favoriteSparkTimerRef.current);
    };
  }, []);

  useLayoutEffect(() => {
    favoriteRequestGenerationRef.current += 1;
    window.clearTimeout(favoriteSparkTimerRef.current);
    window.clearTimeout(statusTimerRef.current);
    setFavoriteGroups([]);
    setFavoriteItems([]);
    setFavoritePopoverSourceId(null);
    setFavoriteError("");
    setFavoriteGroupDraft("");
    setFavoriteSparkSourceId(null);
    setLastFavoriteToastSourceId(null);
    setRenamingGroupId(null);
    setRenameGroupDraft("");
    setStatusMessage("");
  }, [favoriteIdentity]);

  useEffect(() => {
    if (!canUseFavorites) return;

    const controller = new AbortController();
    const requestGeneration = favoriteRequestGenerationRef.current;
    void loadFavoriteState(controller.signal, requestGeneration);

    return () => {
      controller.abort();
    };
  }, [canUseFavorites, favoriteIdentity]);

  const visibleColumns = useMemo(() => distributePromptPoolItems(items, columnCount), [columnCount, items]);
  const hasMoreItems = nextOffset !== null;
  const hasActiveFilters = deferredQuery.trim().length > 0 || mediaFilter !== "all" || modelFilter !== "all";
  const activeFilterSummary = [
    deferredQuery.trim() ? `“${deferredQuery.trim()}”` : "",
    mediaFilter === "all" ? "" : mediaFilterLabel(mediaFilter, t),
    modelFilter === "all" ? "" : modelFilter
  ]
    .filter(Boolean)
    .join(" · ");
  const favoriteBySourceId = useMemo(() => new Map(favoriteItems.map((favorite) => [favorite.sourceId, favorite])), [favoriteItems]);
  const favoritePopoverItem = favoritePopoverSourceId ? items.find((item) => item.id === favoritePopoverSourceId) ?? null : null;
  const favoritePopoverFavorite = favoritePopoverSourceId ? favoriteBySourceId.get(favoritePopoverSourceId) ?? null : null;

  function showStatus(message: string, favoriteSourceId?: string): void {
    window.clearTimeout(statusTimerRef.current);
    setOperationError("");
    setStatusMessage(message);
    setLastFavoriteToastSourceId(favoriteSourceId ?? null);
    statusTimerRef.current = window.setTimeout(() => {
      setStatusMessage("");
      setLastFavoriteToastSourceId(null);
    }, 2600);
  }

  function isCurrentFavoriteRequest(requestGeneration: number): boolean {
    return favoriteRequestGenerationRef.current === requestGeneration;
  }

  async function loadFavoriteState(signal: AbortSignal, requestGeneration: number): Promise<void> {
    setFavoriteError("");
    try {
      const nextFavorites = await fetchPromptFavorites(signal);
      if (!signal.aborted && isCurrentFavoriteRequest(requestGeneration)) {
        setFavoriteGroups(nextFavorites.groups);
        setFavoriteItems(nextFavorites.favorites);
      }
    } catch {
      if (!signal.aborted && isCurrentFavoriteRequest(requestGeneration)) {
        setFavoriteError(t("favoriteLoadFailed"));
      }
    }
  }

  async function fetchPromptPoolPage(offset: number, limit: number, signal?: AbortSignal): Promise<PromptPoolResponse> {
    const params = promptPoolSearchParams(deferredQuery, mediaFilter, modelFilter, sortMode);
    params.set("limit", String(limit));
    params.set("offset", String(offset));

    const response = await apiFetch(`/api/pool?${params.toString()}`, { signal });
    if (!response.ok) {
      throw new Error(t("poolRequestFailed", { status: response.status }));
    }

    const body = (await response.json()) as PromptPoolResponse;
    if (!Array.isArray(body.items) || !body.summary || !Array.isArray(body.modelOptions)) {
      throw new Error(t("poolServiceInvalidData"));
    }
    return body;
  }

  function syncPromptPoolPage(body: PromptPoolResponse, appendItems: boolean): void {
    if (appendItems) {
      setItems((current) => [...current, ...body.items]);
    } else {
      setItems(body.items);
    }
    setModelOptions(body.modelOptions);
    setNextOffset(body.nextOffset);
    setReadyCount(body.readyCount);
    setSummary(body.summary);
    setTotalCount(body.totalCount);
    setPageError(body.available ? "" : t("poolDataMissing"));
  }

  async function loadMorePromptPoolItems(): Promise<void> {
    if (nextOffset === null || isLoadingMore) {
      return;
    }

    setIsLoadingMore(true);
    setOperationError("");
    const requestQueryKey = poolQueryKey;
    try {
      const body = await fetchPromptPoolPage(nextOffset, LOAD_MORE_COUNT);
      if (poolQueryKeyRef.current !== requestQueryKey) {
        return;
      }
      syncPromptPoolPage(body, true);
    } catch (loadError) {
      setOperationError(loadError instanceof Error ? loadError.message : t("poolLoadFailed"));
    } finally {
      setIsLoadingMore(false);
    }
  }

  async function loadPromptPoolItem(item: PromptPoolListItem | PromptPoolItem): Promise<PromptPoolItem> {
    if ("prompt" in item) {
      return item;
    }

    const cached = hydratedItemsRef.current.get(item.id);
    if (cached) {
      return cached;
    }

    const response = await apiFetch(`/api/pool/${encodeURIComponent(item.id)}`);
    if (!response.ok) {
      throw new Error(t("poolRequestFailed", { status: response.status }));
    }

    const body = (await response.json()) as PromptPoolItemResponse;
    if (!body.item?.prompt) {
      throw new Error(t("poolServiceInvalidData"));
    }

    hydratedItemsRef.current.set(body.item.id, body.item);
    return body.item;
  }

  async function copyPrompt(item: PromptPoolListItem | PromptPoolItem): Promise<void> {
    try {
      const hydratedItem = await loadPromptPoolItem(item);
      await writeClipboardText(hydratedItem.prompt);
      window.clearTimeout(copiedTimerRef.current);
      setCopiedId(item.id);
      copiedTimerRef.current = window.setTimeout(() => {
        setCopiedId((current) => (current === item.id ? null : current));
      }, 1800);
      showStatus(t("poolCopiedPrompt"));
    } catch {
      setOperationError(t("poolCopyFailed"));
    }
  }

  async function openPromptDetail(item: PromptPoolListItem): Promise<void> {
    try {
      setSelectedItem(await loadPromptPoolItem(item));
    } catch (loadError) {
      setOperationError(loadError instanceof Error ? loadError.message : t("poolLoadFailed"));
    }
  }

  async function usePromptPoolItem(item: PromptPoolListItem | PromptPoolItem): Promise<void> {
    try {
      onUsePrompt(await loadPromptPoolItem(item));
    } catch (loadError) {
      setOperationError(loadError instanceof Error ? loadError.message : t("poolLoadFailed"));
    }
  }

  function resetFilters(): void {
    setQuery("");
    setMediaFilter("all");
    setModelFilter("all");
    setSortMode("latest");
  }

  async function togglePromptFavorite(item: PromptPoolListItem | PromptPoolItem): Promise<void> {
    if (!canUseFavorites) {
      showStatus(t("favoriteLoginRequired"));
      return;
    }

    const existing = favoriteBySourceId.get(item.id);
    setFavoriteError("");
    if (existing) {
      setFavoritePopoverSourceId(item.id);
      setFavoriteGroupDraft("");
      setRenamingGroupId(null);
      return;
    }

    const requestGeneration = favoriteRequestGenerationRef.current;
    try {
      const favorite = await createPromptFavorite({ promptPoolItemId: item.id });
      if (!isCurrentFavoriteRequest(requestGeneration)) {
        return;
      }
      upsertFavorite(favorite);
      emitPromptFavoritesInvalidation();
      setFavoriteSparkSourceId(item.id);
      window.clearTimeout(favoriteSparkTimerRef.current);
      favoriteSparkTimerRef.current = window.setTimeout(() => setFavoriteSparkSourceId(null), 520);
      showStatus(t("favoriteAdded", { group: favoriteGroupName(favorite.groupId, favoriteGroups, t) }), item.id);
    } catch {
      if (isCurrentFavoriteRequest(requestGeneration)) setFavoriteError(t("favoriteAddFailed"));
    }
  }

  async function movePromptFavorite(favorite: PromptFavoriteItem, groupId: string): Promise<void> {
    const requestGeneration = favoriteRequestGenerationRef.current;
    setFavoriteError("");
    try {
      const updatedFavorite = await updatePromptFavorite(favorite.id, { groupId });
      if (!isCurrentFavoriteRequest(requestGeneration)) {
        return;
      }
      upsertFavorite(updatedFavorite);
      emitPromptFavoritesInvalidation();
      setFavoritePopoverSourceId(null);
      setFavoriteGroupDraft("");
    } catch {
      if (isCurrentFavoriteRequest(requestGeneration)) setFavoriteError(t("favoriteMoveFailed"));
    }
  }

  async function removePromptFavorite(favorite: PromptFavoriteItem): Promise<void> {
    const requestGeneration = favoriteRequestGenerationRef.current;
    setFavoriteError("");
    try {
      await deletePromptFavorite(favorite.id);
      if (!isCurrentFavoriteRequest(requestGeneration)) {
        return;
      }
      setFavoriteItems((current) => current.filter((item) => item.id !== favorite.id));
      emitPromptFavoritesInvalidation();
      setFavoritePopoverSourceId(null);
      setLastFavoriteToastSourceId(null);
    } catch {
      if (isCurrentFavoriteRequest(requestGeneration)) setFavoriteError(t("favoriteCancelFailed"));
    }
  }

  async function addFavoriteGroup(): Promise<void> {
    const name = favoriteGroupDraft.trim();
    if (!name) {
      return;
    }

    const requestGeneration = favoriteRequestGenerationRef.current;
    setFavoriteError("");
    try {
      const group = await createPromptFavoriteGroup({ name });
      if (!isCurrentFavoriteRequest(requestGeneration)) {
        return;
      }
      upsertGroup(group);
      emitPromptFavoritesInvalidation();
      setFavoriteGroupDraft("");
      if (favoritePopoverFavorite) {
        await movePromptFavorite(favoritePopoverFavorite, group.id);
      }
    } catch {
      if (isCurrentFavoriteRequest(requestGeneration)) setFavoriteError(t("favoriteCreateGroupFailed"));
    }
  }

  async function renameFavoriteGroup(group: PromptFavoriteGroup): Promise<void> {
    const name = renameGroupDraft.trim();
    if (!name) {
      return;
    }

    const requestGeneration = favoriteRequestGenerationRef.current;
    setFavoriteError("");
    try {
      const updatedGroup = await updatePromptFavoriteGroup(group.id, { name });
      if (!isCurrentFavoriteRequest(requestGeneration)) {
        return;
      }
      upsertGroup(updatedGroup);
      emitPromptFavoritesInvalidation();
      setRenamingGroupId(null);
      setRenameGroupDraft("");
    } catch {
      if (isCurrentFavoriteRequest(requestGeneration)) setFavoriteError(t("favoriteRenameGroupFailed"));
    }
  }

  async function removeFavoriteGroup(group: PromptFavoriteGroup): Promise<void> {
    const requestGeneration = favoriteRequestGenerationRef.current;
    setFavoriteError("");
    try {
      await deletePromptFavoriteGroup(group.id);
      if (!isCurrentFavoriteRequest(requestGeneration)) {
        return;
      }
      const defaultGroup = favoriteGroups.find((item) => item.isDefault) ?? favoriteGroups[0];
      setFavoriteGroups((current) => current.filter((item) => item.id !== group.id));
      if (defaultGroup) {
        setFavoriteItems((current) =>
          current.map((favorite) => (favorite.groupId === group.id ? { ...favorite, groupId: defaultGroup.id } : favorite))
        );
      }
      emitPromptFavoritesInvalidation();
    } catch {
      if (isCurrentFavoriteRequest(requestGeneration)) setFavoriteError(t("favoriteDeleteGroupFailed"));
    }
  }

  function upsertFavorite(favorite: PromptFavoriteItem): void {
    setFavoriteItems((current) => [favorite, ...current.filter((item) => item.id !== favorite.id && item.sourceId !== favorite.sourceId)]);
  }

  function upsertGroup(group: PromptFavoriteGroup): void {
    setFavoriteGroups((current) =>
      [group, ...current.filter((item) => item.id !== group.id)].sort(
        (left, right) => left.sortOrder - right.sortOrder || left.createdAt.localeCompare(right.createdAt)
      )
    );
  }

  return (
    <main className="pool-page app-view" data-testid="pool-page">
      <div className="pool-page__inner">
        <header className="pool-header">
          <div className="pool-header__copy">
            <p className="pool-kicker">
              <Sparkles className="size-3.5" aria-hidden="true" />
              {t("poolKicker")}
            </p>
            <h1>{t("poolTitle")}</h1>
          </div>

          <div className="pool-header__meta" aria-label={t("poolHeaderMeta", { count: summary?.promptCount ?? items.length })}>
            <strong>{summary?.promptCount ?? items.length}</strong>
            <span>{t("poolPromptCount")}</span>
            <span>{t("poolAssetCount", { count: summary?.assetCount ?? 0 })}</span>
          </div>

          <SearchField
            ariaLabel={t("poolSearchAria")}
            dataTestId="pool-search"
            id="pool-search-input"
            inputClassName="pool-search__input"
            name="pool-search"
            placeholder={t("poolSearchPlaceholder")}
            value={query}
            wrapperClassName="pool-search"
            onChange={setQuery}
          />
        </header>

        <section className="pool-toolbar" aria-label={t("poolFiltersLabel")}>
          <div className="pool-segmented" data-testid="pool-media-filter" role="group" aria-label={t("poolMediaLabel")}>
            {(["all", "image", "video"] as const).map((value) => (
              <button
                aria-pressed={mediaFilter === value}
                className="pool-segmented__button"
                data-active={mediaFilter === value}
                key={value}
                type="button"
                onClick={() => setMediaFilter(value)}
              >
                <PromptPoolMediaFilterIcon value={value} />
                {mediaFilterLabel(value, t)}
              </button>
            ))}
          </div>

          <label className="pool-select-field">
            <span>{t("poolModelLabel")}</span>
            <select value={modelFilter} onChange={(event) => setModelFilter(event.target.value)}>
              <option value="all">{t("poolAllModels")}</option>
              {modelOptions.map((option) => (
                <option key={option.model} value={option.model}>
                  {option.model} ({option.count})
                </option>
              ))}
            </select>
          </label>

          <label className="pool-select-field">
            <span>{t("poolSortLabel")}</span>
            <select value={sortMode} onChange={(event) => setSortMode(event.target.value as PromptPoolSortMode)}>
              <option value="latest">{t("poolSortLatest")}</option>
              <option value="popular">{t("poolSortPopular")}</option>
              <option value="ready">{t("poolSortReady")}</option>
            </select>
          </label>

          <button className="pool-reset" type="button" onClick={resetFilters}>
            <Repeat2 className="size-4" aria-hidden="true" />
            {t("poolResetFilters")}
          </button>
        </section>

        {pageError ? (
          <div className="pool-alert pool-alert--error" data-testid="pool-error" role="alert">
            <X className="size-4 shrink-0" aria-hidden="true" />
            <p>{pageError}</p>
          </div>
        ) : null}
        {operationError ? (
          <div className="pool-alert pool-alert--warning" data-testid="pool-operation-error" role="alert">
            <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
            <p>{operationError}</p>
          </div>
        ) : null}
        {canUseFavorites && favoriteError ? (
          <div className="pool-alert pool-alert--warning" data-testid="favorite-error" role="alert">
            <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
            <p>{favoriteError}</p>
          </div>
        ) : null}
        {statusMessage ? (
          <div className="pool-alert pool-alert--success" data-testid="pool-message" role="status">
            <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
            <p>{statusMessage}</p>
            {lastFavoriteToastSourceId ? (
              <button className="pool-alert__action" type="button" onClick={() => setFavoritePopoverSourceId(lastFavoriteToastSourceId)}>
                {t("favoriteChangeGroup")}
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="pool-result-strip" aria-live="polite">
          <span>{t("poolShowingCount", { visible: items.length, total: totalCount })}</span>
          <span>{t("poolReadyCount", { count: readyCount })}</span>
        </div>

        {isLoading ? (
          <div className="pool-empty-state" data-testid="pool-loading" role="status">
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
            <p>{t("poolLoading")}</p>
          </div>
        ) : pageError ? null : totalCount === 0 ? (
          <div className="pool-empty-state" data-testid="pool-empty">
            <WandSparkles className="size-7" aria-hidden="true" />
            <div>
              <p>{hasActiveFilters ? t("poolNoMatches", { query: deferredQuery.trim() }) : t("poolEmpty")}</p>
              <span>{hasActiveFilters ? t("poolNoMatchesHint", { filters: activeFilterSummary }) : t("poolEmptyHint")}</span>
            </div>
          </div>
        ) : (
          <>
            <div className="pool-masonry" data-testid="pool-masonry" style={promptPoolColumnStyle(columnCount)}>
              {visibleColumns.map((columnItems, columnIndex) => (
                <div className="pool-masonry__column" key={`pool-column-${columnIndex}`}>
                  {columnItems.map((item) => (
                    <PromptPoolCard
                      copied={copiedId === item.id}
                      favorite={favoriteBySourceId.get(item.id)}
                      favoriteSpark={favoriteSparkSourceId === item.id}
                      item={item}
                      key={item.id}
                      numberFormat={numberFormat}
                      showFavorite={canUseFavorites}
                      onCopy={() => void copyPrompt(item)}
                      onFavorite={() => void togglePromptFavorite(item)}
                      onOpen={() => void openPromptDetail(item)}
                      onUse={() => void usePromptPoolItem(item)}
                    />
                  ))}
                </div>
              ))}
            </div>

            {hasMoreItems ? (
              <button className="pool-load-more" disabled={isLoadingMore} type="button" onClick={() => void loadMorePromptPoolItems()}>
                {isLoadingMore ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                {t("poolLoadMore", { count: Math.min(LOAD_MORE_COUNT, Math.max(0, totalCount - items.length)) })}
                {!isLoadingMore ? <ArrowRight className="size-4" aria-hidden="true" /> : null}
              </button>
            ) : null}
          </>
        )}
      </div>

      {selectedItem ? (
        <PromptPoolDetailDialog
          copied={copiedId === selectedItem.id}
          favorite={favoriteBySourceId.get(selectedItem.id)}
          favoriteSpark={favoriteSparkSourceId === selectedItem.id}
          item={selectedItem}
          numberFormat={numberFormat}
          showFavorite={canUseFavorites}
          onClose={() => setSelectedItem(null)}
          onCopy={() => void copyPrompt(selectedItem)}
          onFavorite={() => void togglePromptFavorite(selectedItem)}
          onUse={() => void usePromptPoolItem(selectedItem)}
        />
      ) : null}
      {canUseFavorites && favoritePopoverItem && favoritePopoverFavorite ? (
        <PromptFavoritePopover
          favorite={favoritePopoverFavorite}
          groupDraft={favoriteGroupDraft}
          groups={favoriteGroups}
          renameDraft={renameGroupDraft}
          renamingGroupId={renamingGroupId}
          onAddGroup={() => void addFavoriteGroup()}
          onCancelFavorite={() => void removePromptFavorite(favoritePopoverFavorite)}
          onChangeGroup={(groupId) => void movePromptFavorite(favoritePopoverFavorite, groupId)}
          onClose={() => setFavoritePopoverSourceId(null)}
          onDeleteGroup={(group) => void removeFavoriteGroup(group)}
          onGroupDraftChange={setFavoriteGroupDraft}
          onRenameDraftChange={setRenameGroupDraft}
          onRenameGroup={(group) => void renameFavoriteGroup(group)}
          onRenameStart={(group) => {
            setRenamingGroupId(group.id);
            setRenameGroupDraft(group.name);
          }}
        />
      ) : null}
    </main>
  );
}

function PromptPoolCard({
  copied,
  favorite,
  favoriteSpark,
  item,
  numberFormat,
  showFavorite,
  onCopy,
  onFavorite,
  onOpen,
  onUse
}: {
  copied: boolean;
  favorite: PromptFavoriteItem | undefined;
  favoriteSpark: boolean;
  item: PromptPoolListItem;
  numberFormat: Intl.NumberFormat;
  showFavorite: boolean;
  onCopy: () => void;
  onFavorite: () => void;
  onOpen: () => void;
  onUse: () => void;
}) {
  const { t } = useI18n();
  const excerpt = item.promptExcerpt;

  return (
    <article className="pool-card" data-favorite={Boolean(favorite)} data-media={item.mediaType} data-testid="pool-card">
      <div className="pool-card__media">
        <PromptPoolAssetImage
          alt={item.title}
          imageClassName="pool-card__image"
          loading="lazy"
          openLabel={t("poolActionOpenDetail", { excerpt })}
          src={item.assetUrl}
          style={promptPoolImageRatioStyle(item)}
          wrapperClassName="pool-card__image-button"
          height={item.imageHeight}
          width={item.imageWidth}
          onOpen={onOpen}
        >
          <span className="pool-card__media-type">
            {item.mediaType === "video" ? <Video className="size-3.5" aria-hidden="true" /> : <ImageIcon className="size-3.5" aria-hidden="true" />}
            {mediaFilterLabel(item.mediaType, t)}
          </span>
          {item.imageCount > 1 ? <span className="pool-card__stack">+{item.imageCount - 1}</span> : null}
        </PromptPoolAssetImage>
        {showFavorite ? (
          <button
            aria-label={favorite ? t("favoriteSaved") : t("favoriteSave")}
            className="pool-favorite-button"
            data-active={Boolean(favorite)}
            data-spark={favoriteSpark}
            title={favorite ? t("favoriteSaved") : t("favoriteSave")}
            type="button"
            onClick={onFavorite}
          >
            <span className="pool-favorite-button__icon-stack" aria-hidden="true">
              <Bookmark className="pool-favorite-button__icon pool-favorite-button__icon--off size-4" />
              <BookmarkCheck className="pool-favorite-button__icon pool-favorite-button__icon--on size-4" />
            </span>
            <span className="pool-favorite-button__spark" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <div className="pool-card__body">
        <div className="pool-card__tags">
          <span>{item.model}</span>
          {item.imageWidth && item.imageHeight ? <span>{item.imageWidth} x {item.imageHeight}</span> : null}
          <span>{item.promptReady ? t("poolPromptReady") : t("poolPromptDraft")}</span>
        </div>
        <h2>{item.title}</h2>
        <p className="pool-card__prompt">{segmentCjkPhrases(item.promptExcerpt)}</p>
        <footer className="pool-card__footer">
          <div className="pool-card__stats" aria-label={t("poolStatsLabel")}>
            <span title={t("poolViews")}>
              <Eye className="size-3.5" aria-hidden="true" />
              {numberFormat.format(item.stats.views)}
            </span>
            <span title={t("poolLikes")}>
              <Heart className="size-3.5" aria-hidden="true" />
              {numberFormat.format(item.stats.likes)}
            </span>
          </div>
          <div className="pool-card__actions">
            <button
              aria-label={copied ? t("poolCopiedPrompt") : t("poolActionCopyPrompt", { excerpt })}
              className="pool-icon-action"
              data-copied={copied}
              title={copied ? t("poolCopiedPrompt") : t("commonCopy")}
              type="button"
              onClick={onCopy}
            >
              <span className="pool-icon-action__stack" aria-hidden="true">
                <Copy className="pool-icon-action__icon pool-icon-action__icon--copy size-4" />
                <CheckCircle2 className="pool-icon-action__icon pool-icon-action__icon--check size-4" />
              </span>
            </button>
            <button className="pool-use-action" type="button" onClick={onUse}>
              <WandSparkles className="size-4" aria-hidden="true" />
              {t("poolUseToCanvas")}
            </button>
          </div>
        </footer>
      </div>
    </article>
  );
}

function PromptPoolAssetImage({
  alt,
  children,
  height,
  imageClassName,
  loading,
  openLabel,
  src,
  style,
  width,
  wrapperClassName,
  onOpen
}: {
  alt: string;
  children?: ReactNode;
  height?: number;
  imageClassName: string;
  loading?: "eager" | "lazy";
  openLabel?: string;
  src: string;
  style?: CSSProperties;
  width?: number;
  wrapperClassName: string;
  onOpen?: () => void;
}) {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const attempt = `${src}\u0000${revision}`;
  const attemptRef = useRef(attempt);
  attemptRef.current = attempt;

  useEffect(() => {
    setFailed(false);
    setRevision(0);
  }, [src]);

  function markUnavailable(): void {
    if (attemptRef.current === attempt) setFailed(true);
  }

  function validateLoadedImage(image: HTMLImageElement): void {
    if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
      markUnavailable();
      return;
    }
    void image.decode().catch(markUnavailable);
  }

  function retryAsset(): void {
    setFailed(false);
    setRevision((current) => current + 1);
  }

  if (failed) {
    return (
      <div
        aria-label={t("galleryAssetUnavailable")}
        className={`${wrapperClassName} pool-asset-fallback`}
        role="group"
        style={style}
      >
        <ImageOff className="size-5" aria-hidden="true" />
        <span>{t("galleryAssetUnavailable")}</span>
        <div className="pool-asset-fallback__actions">
          <button type="button" onClick={retryAsset}>
            <RotateCcw className="size-3.5" aria-hidden="true" />
            {t("galleryAssetRetry")}
          </button>
          {onOpen ? (
            <button type="button" onClick={onOpen}>
              {t("poolDetailTitle")}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  const image = (
    <img
      alt={alt}
      className={imageClassName}
      decoding="async"
      height={height}
      key={`${src}-${revision}`}
      loading={loading}
      referrerPolicy="no-referrer"
      src={retryablePromptPoolAssetUrl(src, revision)}
      width={width}
      onError={markUnavailable}
      onLoad={(event) => validateLoadedImage(event.currentTarget)}
    />
  );

  return onOpen ? (
    <button aria-label={openLabel ?? alt} className={wrapperClassName} style={style} type="button" onClick={onOpen}>
      {image}
      {children}
    </button>
  ) : image;
}

function segmentCjkPhrases(value: string): Array<string | JSX.Element> {
  return value.split(/(\p{Script=Han}+)/gu).map((segment, index) =>
    segment.length > 1 && segment.length <= 12 && /^\p{Script=Han}+$/u.test(segment) ? (
      <span className="pool-card__cjk-phrase" key={`${index}-${segment}`}>
        {segment}
      </span>
    ) : (
      segment
    )
  );
}

function PromptPoolDetailDialog({
  copied,
  favorite,
  favoriteSpark,
  item,
  numberFormat,
  showFavorite,
  onClose,
  onCopy,
  onFavorite,
  onUse
}: {
  copied: boolean;
  favorite: PromptFavoriteItem | undefined;
  favoriteSpark: boolean;
  item: PromptPoolItem;
  numberFormat: Intl.NumberFormat;
  showFavorite: boolean;
  onClose: () => void;
  onCopy: () => void;
  onFavorite: () => void;
  onUse: () => void;
}) {
  const { t } = useI18n();
  const dialogRef = useModalFocus<HTMLDivElement>(onClose);

  return createPortal(
    <div className="pool-modal-backdrop app-modal-backdrop" data-testid="pool-detail" role="presentation">
      <div
        aria-labelledby="pool-detail-title"
        aria-modal="true"
        className="pool-modal app-modal-surface"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="pool-modal__header">
          <div className="pool-modal__title">
            <p>{t("poolDetailEyebrow")}</p>
            <h2 id="pool-detail-title">{t("poolDetailTitle")}</h2>
          </div>
          <div className="pool-modal__header-actions">
            {showFavorite ? (
              <button
                aria-label={favorite ? t("favoriteSaved") : t("favoriteSave")}
                className="pool-favorite-button pool-favorite-button--modal"
                data-active={Boolean(favorite)}
                data-spark={favoriteSpark}
                title={favorite ? t("favoriteSaved") : t("favoriteSave")}
                type="button"
                onClick={onFavorite}
              >
                <span className="pool-favorite-button__icon-stack" aria-hidden="true">
                  <Bookmark className="pool-favorite-button__icon pool-favorite-button__icon--off size-4" />
                  <BookmarkCheck className="pool-favorite-button__icon pool-favorite-button__icon--on size-4" />
                </span>
                <span className="pool-favorite-button__spark" aria-hidden="true" />
              </button>
            ) : null}
            <button aria-label={t("commonClose")} className="pool-icon-action pool-modal__close" type="button" onClick={onClose}>
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="pool-modal__body">
          <div className="pool-modal__media">
            <PromptPoolAssetImage
              alt={item.title}
              imageClassName="pool-modal__image"
              src={item.assetUrl}
              wrapperClassName="pool-modal__asset"
              height={item.imageHeight}
              width={item.imageWidth}
            />
          </div>
          <aside className="pool-modal__copy">
            <div className="pool-card__tags">
              <span>{item.model}</span>
              <span>{mediaFilterLabel(item.mediaType, t)}</span>
              {item.imageWidth && item.imageHeight ? <span>{item.imageWidth} x {item.imageHeight}</span> : null}
              {item.postedAt ? <span>{item.postedAt}</span> : null}
            </div>
            <h3>{item.title}</h3>
            {item.author ? (
              <p className="pool-modal__author">
                {item.author.name}
                {item.author.username ? <span>@{item.author.username}</span> : null}
              </p>
            ) : null}
            <div className="pool-modal__stats">
              <span>
                <Eye className="size-3.5" aria-hidden="true" />
                {numberFormat.format(item.stats.views)}
              </span>
              <span>
                <Heart className="size-3.5" aria-hidden="true" />
                {numberFormat.format(item.stats.likes)}
              </span>
              <span>
                <Repeat2 className="size-3.5" aria-hidden="true" />
                {numberFormat.format(item.stats.retweets)}
              </span>
            </div>
            <section className="pool-modal__prompt">
              <h4>{t("poolPromptLabel")}</h4>
              <p>{item.prompt}</p>
            </section>
          </aside>
        </div>

        <footer className="pool-modal__actions">
          <button className="secondary-action h-10" data-copied={copied} type="button" onClick={onCopy}>
            {copied ? <CheckCircle2 className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
            {t("commonCopy")}
          </button>
          <button className="primary-action h-10" type="button" onClick={onUse}>
            <WandSparkles className="size-4" aria-hidden="true" />
            {t("poolUseToCanvas")}
          </button>
        </footer>
      </div>
    </div>,
    document.body
  );
}

function PromptFavoritePopover({
  favorite,
  groups,
  groupDraft,
  renameDraft,
  renamingGroupId,
  onAddGroup,
  onCancelFavorite,
  onChangeGroup,
  onClose,
  onDeleteGroup,
  onGroupDraftChange,
  onRenameDraftChange,
  onRenameGroup,
  onRenameStart
}: {
  favorite: PromptFavoriteItem;
  groups: PromptFavoriteGroup[];
  groupDraft: string;
  renameDraft: string;
  renamingGroupId: string | null;
  onAddGroup: () => void;
  onCancelFavorite: () => void;
  onChangeGroup: (groupId: string) => void;
  onClose: () => void;
  onDeleteGroup: (group: PromptFavoriteGroup) => void;
  onGroupDraftChange: (value: string) => void;
  onRenameDraftChange: (value: string) => void;
  onRenameGroup: (group: PromptFavoriteGroup) => void;
  onRenameStart: (group: PromptFavoriteGroup) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="prompt-favorite-popover" data-testid="favorite-popover" role="dialog" aria-label={t("favoriteGroupLabel")}>
      <header className="prompt-favorite-popover__header">
        <div>
          <p>{t("favoriteGroupLabel")}</p>
          <strong>{favorite.title}</strong>
        </div>
        <button className="history-icon-action" aria-label={t("commonClose")} type="button" onClick={onClose}>
          <X className="size-4" aria-hidden="true" />
        </button>
      </header>
      <div className="prompt-favorite-popover__groups">
        {groups.map((group) => (
          <div className="prompt-favorite-popover__group" key={group.id} data-active={favorite.groupId === group.id}>
            {renamingGroupId === group.id ? (
              <form
                className="prompt-favorite-popover__rename"
                onSubmit={(event) => {
                  event.preventDefault();
                  onRenameGroup(group);
                }}
              >
                <input
                  aria-label={t("favoriteRenameGroup")}
                  value={renameDraft}
                  onChange={(event) => onRenameDraftChange(event.target.value)}
                />
                <button className="history-icon-action" type="submit" aria-label={t("favoriteRenameGroup")}>
                  <CheckCircle2 className="size-4" aria-hidden="true" />
                </button>
              </form>
            ) : (
              <button className="prompt-favorite-popover__group-button" type="button" onClick={() => onChangeGroup(group.id)}>
                <BookmarkCheck className="size-4" aria-hidden="true" />
                <span>{group.name}</span>
              </button>
            )}
            <div className="prompt-favorite-popover__group-actions">
              <button className="history-icon-action" type="button" aria-label={t("favoriteRenameGroup")} onClick={() => onRenameStart(group)}>
                <Pencil className="size-3.5" aria-hidden="true" />
              </button>
              {!group.isDefault ? (
                <button className="history-icon-action" type="button" aria-label={t("favoriteDeleteGroup")} onClick={() => onDeleteGroup(group)}>
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      <form
        className="prompt-favorite-popover__new"
        onSubmit={(event) => {
          event.preventDefault();
          onAddGroup();
        }}
      >
        <input
          aria-label={t("favoriteGroupNamePlaceholder")}
          placeholder={t("favoriteGroupNamePlaceholder")}
          value={groupDraft}
          onChange={(event) => onGroupDraftChange(event.target.value)}
        />
        <button className="secondary-action h-10" type="submit">
          <Plus className="size-4" aria-hidden="true" />
          {t("favoriteCreateGroup")}
        </button>
      </form>
      <button className="prompt-favorite-popover__remove" type="button" onClick={onCancelFavorite}>
        <Trash2 className="size-4" aria-hidden="true" />
        {t("favoriteCancel")}
      </button>
    </div>
  );
}

function PromptPoolMediaFilterIcon({ value }: { value: PromptPoolMediaFilter }) {
  if (value === "all") {
    return <Images className="size-4" aria-hidden="true" />;
  }

  if (value === "image") {
    return <ImageIcon className="size-4" aria-hidden="true" />;
  }

  return <Video className="size-4" aria-hidden="true" />;
}

function promptPoolSearchParams(
  query: string,
  mediaFilter: PromptPoolMediaFilter,
  modelFilter: string,
  sortMode: PromptPoolSortMode
): URLSearchParams {
  const params = new URLSearchParams();
  const trimmedQuery = query.trim();

  if (trimmedQuery) {
    params.set("q", trimmedQuery);
  }
  if (mediaFilter !== "all") {
    params.set("mediaType", mediaFilter);
  }
  if (modelFilter !== "all") {
    params.set("model", modelFilter);
  }
  if (sortMode !== "latest") {
    params.set("sort", sortMode);
  }

  return params;
}

function usePromptPoolColumnCount(): number {
  const [columnCount, setColumnCount] = useState(() =>
    typeof window === "undefined" ? 4 : promptPoolColumnCountForWidth(window.innerWidth)
  );

  useEffect(() => {
    const handleResize = (): void => {
      setColumnCount(promptPoolColumnCountForWidth(window.innerWidth));
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return columnCount;
}

function promptPoolColumnCountForWidth(width: number): number {
  if (width <= 767) {
    return 1;
  }

  if (width <= 1023) {
    return 2;
  }

  if (width <= 1360) {
    return 3;
  }

  return 4;
}

function distributePromptPoolItems(items: PromptPoolListItem[], columnCount: number): PromptPoolListItem[][] {
  const safeColumnCount = Math.max(1, columnCount);
  const columns = Array.from({ length: safeColumnCount }, () => ({
    items: [] as PromptPoolListItem[],
    heightScore: 0
  }));

  items.forEach((item) => {
    const shortestColumn = columns.reduce((current, candidate) =>
      candidate.heightScore < current.heightScore ? candidate : current
    );
    shortestColumn.items.push(item);
    shortestColumn.heightScore += estimatePromptPoolCardHeight(item);
  });

  return columns.map((column) => column.items);
}

function estimatePromptPoolCardHeight(item: PromptPoolListItem): number {
  const mediaRatio = item.imageWidth && item.imageHeight ? item.imageHeight / item.imageWidth : 0.78;
  const promptWeight = Math.min(1.2, item.promptExcerpt.length / 420);
  const tagWeight = item.imageWidth && item.imageHeight ? 0.18 : 0.08;
  return Math.min(1.85, Math.max(0.56, mediaRatio)) + promptWeight + tagWeight + 0.9;
}

function promptPoolColumnStyle(columnCount: number): CSSProperties {
  return {
    "--pool-column-count": columnCount
  } as CSSProperties;
}

function promptPoolImageRatioStyle(item: PromptPoolListItem | PromptPoolItem): CSSProperties | undefined {
  if (!item.imageWidth || !item.imageHeight) {
    return undefined;
  }

  return {
    "--pool-image-ratio": `${item.imageWidth} / ${item.imageHeight}`
  } as CSSProperties;
}

function retryablePromptPoolAssetUrl(src: string, revision: number): string {
  if (revision === 0 || /^(?:blob|data):/u.test(src) || typeof window === "undefined") return src;

  try {
    const url = new URL(src, window.location.href);
    url.searchParams.set("asset_retry", String(revision));
    return url.origin === window.location.origin ? `${url.pathname}${url.search}${url.hash}` : url.href;
  } catch {
    return src;
  }
}

function mediaFilterLabel(value: PromptPoolMediaFilter, t: ReturnType<typeof useI18n>["t"]): string {
  if (value === "image") {
    return t("poolMediaImage");
  }

  if (value === "video") {
    return t("poolMediaVideo");
  }

  return t("poolAllMedia");
}

function favoriteIdentityBoundary(canUseFavorites: boolean): string {
  if (!canUseFavorites) return "unavailable";
  if (typeof window === "undefined") return "browser-session";

  try {
    const hostUserId = window.sessionStorage.getItem("ai-cove-design.hostUserId")
      ?? window.localStorage.getItem("ai-cove-design.hostUserId");
    if (hostUserId) return `host-user:${hostUserId}`;
    return isDesktopAuthSupported() ? "desktop-session" : "browser-session";
  } catch {
    return isDesktopAuthSupported() ? "desktop-session" : "browser-session";
  }
}

function favoriteGroupName(groupId: string, groups: PromptFavoriteGroup[], t: ReturnType<typeof useI18n>["t"]): string {
  return groups.find((group) => group.id === groupId)?.name ?? groups.find((group) => group.isDefault)?.name ?? t("favoriteDefaultGroup");
}

async function writeClipboardText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.readOnly = true;
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  textArea.style.top = "0";
  document.body.append(textArea);
  textArea.select();

  try {
    const copied = document.execCommand("copy");
    if (!copied) {
      throw new Error("Copy command was not accepted.");
    }
  } finally {
    textArea.remove();
  }
}
