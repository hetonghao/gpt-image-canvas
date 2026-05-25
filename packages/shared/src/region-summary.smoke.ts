import assert from "node:assert/strict";

import {
  MAX_REGION_SUMMARY_IMAGE_BYTES,
  REGION_SUMMARY_IMAGE_MIME_TYPES,
  REGION_SUMMARY_LOCALES
} from "./region-summary.js";

assert.deepEqual(REGION_SUMMARY_LOCALES, ["zh-CN", "en"], "region summary locales are stable");
assert.ok(REGION_SUMMARY_IMAGE_MIME_TYPES.includes("image/png"), "PNG crops are supported");
assert.equal(MAX_REGION_SUMMARY_IMAGE_BYTES, 50 * 1024 * 1024, "region summary crop byte cap matches reference images");

process.stdout.write("region-summary.smoke.ts passed\n");
