import type { JsonRecord } from "./types.js";

export type SourceShape = {
  readonly id: string;
  readonly type: string;
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly index: string;
  readonly pageId?: string;
  readonly pageName?: string;
  readonly props: JsonRecord;
};
