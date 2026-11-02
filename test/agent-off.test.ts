import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { AGENT_OFF, AppContext } from "../src/main/context.ts";
import { Store } from "../src/main/store.ts";
import { runModelTask } from "../src/main/tasks/runner.ts";

const tmp = mkdtempSync(join(tmpdir(), "konkurss-agent-off-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const fakeCrypto = { available: () => true, encrypt: (s: string) => Buffer.from(s, "utf8"), decrypt: (b: Buffer) => b.toString("utf8") };

const store = new Store(join(tmp, "data"), fakeCrypto);
const ctx = new AppContext(store, { pluginDir: tmp, skillsDir: tmp, serverJs: join(tmp, "server.js") }, () => {});

test("the agent switch is on until it is turned off, and the choice is kept in the settings", () => {
	assert.equal(ctx.agentOn(), true);
	store.saveSettings({ agentOn: false });
	assert.equal(ctx.agentOn(), false);
	assert.equal(new Store(join(tmp, "data"), fakeCrypto).settings().agentOn, false, "survives a restart");
	store.saveSettings({ agentOn: true });
	assert.equal(ctx.agentOn(), true);
});

test("switched off: a model task is refused with the plain explanation and nothing is sent to any provider", async () => {
	store.saveSettings({ agentOn: false });
	const engine = ctx.taskEngine();
	const r = await runModelTask({ engine, base: { runDir: tmp, pluginDir: tmp, mcp: { command: "x", args: [], env: {} }, signal: new AbortController().signal }, instructions: "x", schemaHint: "{}", schema: z.object({}), docs: [] });
	assert.deepEqual([r.ok, r.ok ? "" : r.error], [false, AGENT_OFF]);
	store.saveSettings({ agentOn: true });
});
