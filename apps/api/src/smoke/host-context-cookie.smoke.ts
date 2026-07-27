import assert from "node:assert/strict";
import { extractDesignAccessTokenFromCookie } from "../server/host-context.js";

assert.equal(
  extractDesignAccessTokenFromCookie("other=value; ai_cove_design_access=header.payload.signature; theme=dark"),
  "header.payload.signature"
);
assert.equal(extractDesignAccessTokenFromCookie("other=value"), undefined);
assert.equal(extractDesignAccessTokenFromCookie("ai_cove_design_access="), undefined);

process.stdout.write("host-context-cookie.smoke.ts passed\n");
