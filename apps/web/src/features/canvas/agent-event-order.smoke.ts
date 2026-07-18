import assert from "node:assert/strict";
import { acceptsAgentTerminalEvent } from "./agent-event-order";

assert.equal(acceptsAgentTerminalEvent("run-current", new Set(), "run-current"), true);
assert.equal(acceptsAgentTerminalEvent(null, new Set(["run-cancelled"]), "run-cancelled"), true);
assert.equal(acceptsAgentTerminalEvent(null, new Set(), "run-stale"), false);
assert.equal(acceptsAgentTerminalEvent("run-current", new Set(), undefined), true);

process.stdout.write("agent-event-order.smoke.ts passed\n");
