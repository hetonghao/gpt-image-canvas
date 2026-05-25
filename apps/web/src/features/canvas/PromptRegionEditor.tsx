import { Annotation, EditorState, Prec, StateEffect, StateField } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  keymap,
  type DecorationSet,
  type ViewUpdate
} from "@codemirror/view";
import { forwardRef, useEffect, useImperativeHandle, useRef, type MutableRefObject } from "react";

import type { Translate } from "../../shared/i18n";
import {
  insertRegionPromptDocumentTokenAtCursor,
  regionPromptTokenRanges,
  removeRegionPromptItemToken,
  replaceRegionPromptPendingToken,
  type RegionPromptDocumentEdit,
  type RegionPromptLocale,
  type RegionPromptItem,
  type RegionPromptTokenRange
} from "./region-prompt";

interface PromptRegionEditorConfig {
  arrivingIds: Set<string>;
  onHideRegionPreview: (id: string) => void;
  onShowRegionPreview: (id: string, rect: DOMRect) => void;
  regions: RegionPromptItem[];
  locale: RegionPromptLocale;
  t: Translate;
}

export interface PromptRegionEditorHandle {
  focusAtCursor: (cursorIndex?: number) => void;
  getCursorIndex: () => number;
  getRegionTokenRect: (id: string) => DOMRect | null;
  getTargetRect: () => DOMRect | null;
  insertRegionToken: (region: RegionPromptItem, insertionIndex: number) => RegionPromptDocumentEdit | null;
  removeRegionToken: (region: RegionPromptItem) => boolean;
  replaceRegionToken: (region: RegionPromptItem) => boolean;
}

interface PromptRegionEditorProps {
  ariaInvalid: boolean;
  ariaLabel: string;
  arrivingIds: Set<string>;
  id: string;
  isEmpty: boolean;
  onChange: (value: string) => void;
  onCursorChange: (cursorIndex: number) => void;
  onHideRegionPreview: (id: string) => void;
  onShowRegionPreview: (id: string, rect: DOMRect) => void;
  placeholder: string;
  locale: RegionPromptLocale;
  regions: RegionPromptItem[];
  t: Translate;
  testId: string;
  value: string;
}

const promptRegionConfigChanged = StateEffect.define<void>();
const externalPromptSync = Annotation.define<boolean>();
const selectedRegionPromptTokenChanged = StateEffect.define<string | null>();
const selectedRegionPromptTokenField = StateField.define<string | null>({
  create: () => null,
  update: (value, transaction) => {
    const selectionEffect = transaction.effects.find((effect) => effect.is(selectedRegionPromptTokenChanged));
    if (selectionEffect) {
      return selectionEffect.value;
    }
    if (transaction.docChanged || transaction.selection) {
      return null;
    }
    return value;
  }
});

export const PromptRegionEditor = forwardRef<PromptRegionEditorHandle, PromptRegionEditorProps>(function PromptRegionEditor(
  props,
  ref
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const callbacksRef = useRef({
    onChange: props.onChange,
    onCursorChange: props.onCursorChange
  });
  const configRef = useRef<PromptRegionEditorConfig>({
    arrivingIds: props.arrivingIds,
    locale: props.locale,
    onHideRegionPreview: props.onHideRegionPreview,
    onShowRegionPreview: props.onShowRegionPreview,
    regions: props.regions,
    t: props.t
  });

  callbacksRef.current = {
    onChange: props.onChange,
    onCursorChange: props.onCursorChange
  };
  configRef.current = {
    arrivingIds: props.arrivingIds,
    locale: props.locale,
    onHideRegionPreview: props.onHideRegionPreview,
    onShowRegionPreview: props.onShowRegionPreview,
    regions: props.regions,
    t: props.t
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return undefined;
    }

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: props.value,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          selectedRegionPromptTokenField,
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            "aria-invalid": props.ariaInvalid ? "true" : "false",
            "aria-label": props.ariaLabel,
            "aria-multiline": "true",
            "data-testid": props.testId,
            id: props.id,
            role: "textbox",
            spellcheck: "false"
          }),
          Prec.high(
            keymap.of([
              {
                key: "Backspace",
                run: (view) => removeSelectedRegionPromptToken(view, configRef.current.regions)
              }
            ])
          ),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !update.transactions.some((transaction) => transaction.annotation(externalPromptSync))) {
              callbacksRef.current.onChange(update.state.doc.toString());
            }
            if (update.docChanged || update.selectionSet) {
              callbacksRef.current.onCursorChange(update.state.selection.main.from);
            }
            syncRegionTokenDomSelection(update.view, update.state.field(selectedRegionPromptTokenField));
          }),
          regionPromptDecorationExtension(configRef)
        ]
      })
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }

    view.contentDOM.setAttribute("aria-invalid", props.ariaInvalid ? "true" : "false");
    view.contentDOM.setAttribute("aria-label", props.ariaLabel);
  }, [props.ariaInvalid, props.ariaLabel]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }

    const currentValue = view.state.doc.toString();
    if (currentValue !== props.value) {
      view.dispatch({
        annotations: externalPromptSync.of(true),
        changes: { from: 0, to: currentValue.length, insert: props.value }
      });
    }
  }, [props.value]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: promptRegionConfigChanged.of() });
  }, [props.arrivingIds, props.locale, props.regions, props.t, props.onHideRegionPreview, props.onShowRegionPreview]);

  useImperativeHandle(
    ref,
    () => ({
      focusAtCursor: (cursorIndex) => {
        const view = viewRef.current;
        if (view) {
          focusEditorAtCursor(view, cursorIndex);
        }
      },
      getCursorIndex: () => viewRef.current?.state.selection.main.from ?? props.value.length,
      getRegionTokenRect: (id) => {
        const token = regionTokenElement(viewRef.current, id);
        return token?.getBoundingClientRect() ?? null;
      },
      getTargetRect: () => viewRef.current?.dom.getBoundingClientRect() ?? null,
      insertRegionToken: (region, insertionIndex) => {
        const view = viewRef.current;
        if (!view) {
          return null;
        }

        const edit = insertRegionPromptDocumentTokenAtCursor(view.state.doc.toString(), region, insertionIndex);
        if (edit.changed) {
          view.dispatch({
            changes: { from: edit.from, to: edit.to, insert: edit.insert },
            scrollIntoView: true,
            selection: { anchor: edit.cursorIndex }
          });
        } else {
          view.dispatch({
            scrollIntoView: true,
            selection: { anchor: edit.cursorIndex }
          });
        }
        focusEditorAtCursor(view, edit.cursorIndex);
        return edit;
      },
      removeRegionToken: (region) => {
        const view = viewRef.current;
        if (!view) {
          return false;
        }

        const documentText = view.state.doc.toString();
        const range = regionPromptRangeById(documentText, [region], region.id);
        if (!range) {
          const nextPrompt = removeRegionPromptItemToken(documentText, region);
          if (nextPrompt === documentText) {
            return false;
          }
          view.dispatch({ changes: { from: 0, to: documentText.length, insert: nextPrompt } });
          return true;
        }

        return removeRegionPromptRange(view, documentText, range);
      },
      replaceRegionToken: (region) => {
        const view = viewRef.current;
        if (!view) {
          return false;
        }

        const replacement = replaceRegionPromptPendingToken(view.state.doc.toString(), region);
        if (!replacement.changed) {
          return false;
        }
        view.dispatch({
          changes: {
            from: replacement.from,
            to: replacement.to,
            insert: replacement.insert
          }
        });
        return true;
      }
    }),
    [props.value.length]
  );

  return (
    <div
      className="prompt-rich-editor"
      data-empty={props.isEmpty ? "true" : undefined}
      data-placeholder={props.placeholder}
      onMouseDown={(event) => {
        const target = event.target instanceof HTMLElement ? event.target : null;
        if (!target?.closest("[data-region-prompt-item-id]")) {
          const view = viewRef.current;
          if (view) {
            view.dispatch({ effects: selectedRegionPromptTokenChanged.of(null) });
            syncRegionTokenDomSelection(view, null);
          }
        }
        viewRef.current?.focus();
      }}
      ref={hostRef}
    />
  );
});

function focusEditorAtCursor(view: EditorView, cursorIndex = view.state.selection.main.from): void {
  const anchor = Math.max(0, Math.min(view.state.doc.length, cursorIndex));
  view.dispatch({
    scrollIntoView: true,
    selection: { anchor }
  });
  view.focus();
  const win = view.dom.ownerDocument.defaultView;
  win?.requestAnimationFrame(() => {
    view.focus();
    win.requestAnimationFrame(() => view.focus());
  });
}

function regionPromptDecorationExtension(configRef: MutableRefObject<PromptRegionEditorConfig>) {
  const plugin = ViewPlugin.fromClass(
    class RegionPromptDecorations {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = this.buildDecorations(view);
      }

      update(update: ViewUpdate): void {
        if (
          update.docChanged ||
          update.transactions.some((transaction) =>
            transaction.effects.some((effect) => effect.is(promptRegionConfigChanged))
          )
        ) {
          this.decorations = this.buildDecorations(update.view);
        }
      }

      private buildDecorations(view: EditorView): DecorationSet {
        const config = configRef.current;
        const ranges = regionPromptTokenRanges(view.state.doc.toString(), config.regions);
        return Decoration.set(
          ranges.map((range) =>
            Decoration.replace({
              inclusive: false,
              widget: new RegionPromptTokenWidget({
                arriving: config.arrivingIds.has(range.region.id),
                label: range.label,
                locale: config.locale,
                onHideRegionPreview: config.onHideRegionPreview,
                onShowRegionPreview: config.onShowRegionPreview,
                range,
                region: range.region,
                t: config.t
              })
            }).range(range.from, range.to)
          ),
          true
        );
      }
    },
    {
      decorations: (pluginValue) => pluginValue.decorations,
      provide: (pluginDefinition) =>
        EditorView.atomicRanges.of((view) => view.plugin(pluginDefinition)?.decorations ?? Decoration.none)
    }
  );

  return plugin;
}

class RegionPromptTokenWidget extends WidgetType {
  constructor(
    private readonly input: {
      arriving: boolean;
      label: string;
      locale: RegionPromptLocale;
      onHideRegionPreview: (id: string) => void;
      onShowRegionPreview: (id: string, rect: DOMRect) => void;
      range: RegionPromptTokenRange;
      region: RegionPromptItem;
      t: Translate;
    }
  ) {
    super();
  }

  eq(other: RegionPromptTokenWidget): boolean {
    return (
      this.input.arriving === other.input.arriving &&
      this.input.label === other.input.label &&
      this.input.region.id === other.input.region.id &&
      this.input.region.mode === other.input.region.mode &&
      this.input.region.status === other.input.region.status &&
      this.input.region.description === other.input.region.description &&
      this.input.region.cropDataUrl === other.input.region.cropDataUrl &&
      this.input.region.cropAspectRatio === other.input.region.cropAspectRatio &&
      this.input.region.error === other.input.region.error
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const document = view.dom.ownerDocument;
    const token = document.createElement("span");
    token.className = "region-prompt-token";
    token.dataset.mode = this.input.region.mode;
    token.dataset.status = this.input.region.status;
    token.dataset.testid = "region-prompt-token";
    token.dataset.regionPromptItemId = this.input.region.id;
    token.tabIndex = 0;
    if (this.input.arriving) {
      token.dataset.arriving = "true";
    }

    const thumb = document.createElement("span");
    thumb.className = "region-prompt-token__thumb";
    thumb.setAttribute("aria-hidden", "true");
    thumb.style.setProperty("--region-token-thumb-aspect-ratio", this.input.region.cropAspectRatio ?? "1 / 1");
    if (this.input.region.cropDataUrl) {
      const image = document.createElement("img");
      image.alt = "";
      image.src = this.input.region.cropDataUrl;
      thumb.append(image);
    } else {
      const placeholder = document.createElement("span");
      placeholder.className = "region-prompt-token__thumb-placeholder";
      thumb.append(placeholder);
    }

    const labelElement = document.createElement("span");
    labelElement.className = "region-prompt-token__label";
    labelElement.textContent = this.input.label || this.input.t("regionPromptSummarizingLabel");

    token.append(thumb, labelElement);
    if (this.input.region.status === "summarizing") {
      const loader = document.createElement("span");
      loader.className = "region-prompt-token__loader";
      loader.setAttribute("aria-hidden", "true");
      token.append(loader);
    }
    const showPreview = () => this.input.onShowRegionPreview(this.input.region.id, token.getBoundingClientRect());
    const hidePreview = () => this.input.onHideRegionPreview(this.input.region.id);
    const selectToken = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      view.dispatch({
        effects: selectedRegionPromptTokenChanged.of(this.input.region.id),
        scrollIntoView: true,
        selection: { anchor: this.input.range.to }
      });
      view.focus();
      showPreview();
    };
    token.addEventListener("mousedown", selectToken);
    token.addEventListener("mouseenter", showPreview);
    token.addEventListener("focusin", showPreview);
    token.addEventListener("mouseleave", hidePreview);
    token.addEventListener("focusout", (event) => {
      if (event.relatedTarget instanceof Node && token.contains(event.relatedTarget)) {
        return;
      }
      hidePreview();
    });

    return token;
  }

  ignoreEvent(event: Event): boolean {
    return event.type === "mousedown" || event.type === "click";
  }
}

function removeSelectedRegionPromptToken(view: EditorView, regions: RegionPromptItem[]): boolean {
  const selectedRegionId = view.state.field(selectedRegionPromptTokenField, false);
  if (!selectedRegionId) {
    return false;
  }

  const documentText = view.state.doc.toString();
  const range = regionPromptRangeById(documentText, regions, selectedRegionId);
  if (!range) {
    return false;
  }

  return removeRegionPromptRange(view, documentText, range);
}

function removeRegionPromptRange(view: EditorView, documentText: string, range: RegionPromptTokenRange): boolean {
  let from = range.from;
  let to = range.to;
  if (from > 0 && documentText[from - 1] === " " && documentText[to] === " ") {
    to += 1;
  } else if (from === 0 && documentText[to] === " ") {
    to += 1;
  } else if (to === documentText.length && documentText[from - 1] === " ") {
    from -= 1;
  }

  view.dispatch({
    changes: { from, to, insert: "" },
    effects: selectedRegionPromptTokenChanged.of(null),
    selection: { anchor: from }
  });
  return true;
}

function regionPromptRangeById(
  documentText: string,
  regions: RegionPromptItem[],
  regionId: string
): RegionPromptTokenRange | undefined {
  return regionPromptTokenRanges(documentText, regions).find((item) => item.region.id === regionId);
}

function syncRegionTokenDomSelection(view: EditorView, selectedRegionId: string | null): void {
  for (const element of Array.from(view.dom.querySelectorAll<HTMLElement>("[data-region-prompt-item-id]"))) {
    if (selectedRegionId && element.dataset.regionPromptItemId === selectedRegionId) {
      element.dataset.selected = "true";
    } else {
      delete element.dataset.selected;
    }
  }
}

function regionTokenElement(view: EditorView | null, id: string): HTMLElement | null {
  if (!view) {
    return null;
  }
  for (const element of Array.from(view.dom.querySelectorAll<HTMLElement>("[data-region-prompt-item-id]"))) {
    if (element.dataset.regionPromptItemId === id) {
      return element;
    }
  }
  return null;
}
