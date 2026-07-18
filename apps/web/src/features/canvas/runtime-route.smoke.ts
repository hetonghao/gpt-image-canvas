import test from "node:test";
import assert from "node:assert/strict";
import { pathForRoute, searchForInternalNavigation } from "./runtime-route";

test("internal navigation preserves runtime query parameters", () => {
  // Given: embedded mode and host routing context are present.
  const search = "?ui_mode=embedded&base_url=https%3A%2F%2Fapi.example";

  // When: the user navigates to Gallery inside the app.
  const url = pathForRoute("gallery", search);

  // Then: the route changes without dropping runtime context.
  assert.equal(url, `/gallery${search}`);
});

test("internal navigation removes host credentials while preserving non-sensitive runtime parameters", () => {
  const search = searchForInternalNavigation("?ui_mode=embedded&token=secret&user_id=42&contract=keep");
  assert.equal(search, "?ui_mode=embedded&contract=keep");
  assert.equal(pathForRoute("gallery", search), "/gallery?ui_mode=embedded&contract=keep");
});
