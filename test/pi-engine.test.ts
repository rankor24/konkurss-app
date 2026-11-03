// The pi engine's rules, checked without calling any model: who may sign in how, where tokens live, what the engine refuses.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PI_PROVIDERS, PiCredentialStore, createPiRuntime, defaultPiModel, effortsOf, interactionFor, lookupPiModel, loginProvider, piAuthState, thinkingFor, type Seal } from "../src/agent-pi/index.ts";
import { createPiEngine, notReadyReason, piProviderStatuses } from "../src/main/engines/pi.ts";
import type { RunEvent } from "../src/shared/types.ts";

const tmp = mkdtempSync(join(tmpdir(), "konkurss-pi-engine-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

// the same toy "encryption" the store tests use: reversible, but the plain text is not in the file
const seal: Seal = { available: () => true, encrypt: (s) => Buffer.from(s, "utf8").reverse(), decrypt: (b) => Buffer.from(b).reverse().toString("utf8") };
const oauth = { type: "oauth" as const, access: "acc-secret", refresh: "ref-secret", expires: Date.now() + 3_600_000 };

test("tokens are written encrypted, and read back", async () => {
	const path = join(tmp, "a.bin");
	const store = new PiCredentialStore({ path, seal });
	await store.modify("xai", async () => oauth);
	assert.doesNotMatch(readFileSync(path, "latin1"), /acc-secret|ref-secret/);
	assert.deepEqual(await store.read("xai"), oauth);
	assert.deepEqual(await new PiCredentialStore({ path, seal }).read("xai"), oauth, "survives a restart");
	await store.delete("xai");
	assert.equal(await store.read("xai"), undefined);
});

test("no encryption available: tokens are not stored at all", async () => {
	const path = join(tmp, "b.bin");
	const store = new PiCredentialStore({ path, seal: { ...seal, available: () => false } });
	await assert.rejects(store.modify("xai", async () => oauth), /refusing to store/);
	assert.equal(existsSync(path), false);
});

test("a damaged token file means not signed in, not a crash", async () => {
	const path = join(tmp, "c.bin");
	const store = new PiCredentialStore({ path, seal });
	await store.modify("xai", async () => oauth);
	const other = new PiCredentialStore({ path, seal: { ...seal, decrypt: () => "not json" } });
	assert.equal(await other.read("xai"), undefined);
});

test("Claude: a subscription token is refused and never read; the key comes from the app's own store", async () => {
	const path = join(tmp, "d.bin");
	const store = new PiCredentialStore({ path, seal, apiKey: (p) => (p === "anthropic" ? "sk-ant-from-app" : null) });
	await assert.rejects(store.modify("anthropic", async () => oauth), /not permitted for third-party apps/);
	assert.deepEqual(await store.read("anthropic"), { type: "api_key", key: "sk-ant-from-app" });
	assert.equal(await store.read("xai"), undefined, "the Claude key is offered to Claude only");
	// even a token that got into the file some other way is ignored
	const file = join(tmp, "e.bin");
	await new PiCredentialStore({ path: file, seal, blockOAuth: new Set() }).modify("anthropic", async () => oauth);
	assert.equal(await new PiCredentialStore({ path: file, seal }).read("anthropic"), undefined);
	assert.deepEqual((await store.list()).map((c) => c.providerId), ["anthropic"]);
});

test("auth state: Claude needs the key, the subscriptions need a sign-in; environment variables do not count", async () => {
	const saved = { A: process.env.ANTHROPIC_API_KEY, O: process.env.OPENAI_API_KEY, X: process.env.XAI_API_KEY };
	process.env.ANTHROPIC_API_KEY = "sk-ant-env";
	process.env.XAI_API_KEY = "xai-env";
	try {
		let key: string | null = null;
		const rt = createPiRuntime({ path: join(tmp, "f.bin"), seal, apiKey: (p) => (p === "anthropic" ? key : null) });
		assert.equal((await piAuthState(rt, "anthropic")).configured, false, "a key in the environment is not the app's key");
		assert.equal((await piAuthState(rt, "xai")).configured, false);
		assert.equal((await piAuthState(rt, "openai-codex")).configured, false);
		key = "sk-ant-app";
		const claude = await piAuthState(rt, "anthropic");
		assert.deepEqual([claude.configured, claude.method], [true, "api_key"]);
		await rt.credentials.modify("openai-codex", async () => ({ ...oauth, accountId: "acc" }));
		const codex = await piAuthState(rt, "openai-codex");
		assert.deepEqual([codex.configured, codex.method], [true, "oauth"]);
		// a status for the settings screen, in Latvian
		const statuses = await piProviderStatuses(rt);
		assert.deepEqual(statuses.map((s) => [s.id, s.configured]), [["anthropic", true], ["openai-codex", true], ["xai", false]]);
		assert.match(statuses[2].reason, /Pieslēgties/);
		assert.ok(statuses.every((s) => s.models.length > 0 && s.defaultModel));
	} finally {
		for (const [k, v] of [["ANTHROPIC_API_KEY", saved.A], ["OPENAI_API_KEY", saved.O], ["XAI_API_KEY", saved.X]] as const) {
			if (v === undefined) delete process.env[k];
			else process.env[k] = v;
		}
	}
});

test("models: each provider has a default that pi lists; an unknown model is an error with pi's wording", () => {
	const rt = createPiRuntime({ path: join(tmp, "g.bin") });
	for (const p of PI_PROVIDERS) {
		const id = defaultPiModel(rt.models, p.id);
		assert.ok(id && rt.models.getModel(p.id, id), `${p.id} default ${id}`);
	}
	assert.equal(lookupPiModel(rt.models, "anthropic").id, "claude-sonnet-5-5");
	assert.throws(() => lookupPiModel(rt.models, "xai", "grok-nav"), /Unknown model "grok-nav" for provider "xai"/);
	assert.throws(() => lookupPiModel(rt.models, "openai", "gpt-5"), /Unknown provider/);
	const sonnet = lookupPiModel(rt.models, "anthropic");
	assert.equal(thinkingFor(sonnet), "medium");
	assert.ok(!effortsOf(sonnet).includes("off"), "this model has no off switch");
});

test("sign-in: only the two subscriptions; the browser method is chosen; the page is opened; a pasted answer is only asked for when possible", async () => {
	const rt = createPiRuntime({ path: join(tmp, "h.bin"), seal });
	await assert.rejects(loginProvider(rt.models, "anthropic", { openUrl() {}, notify() {} }), /uses an API key/);

	const opened: string[] = [];
	const notices: unknown[] = [];
	const i = interactionFor({ openUrl: (u) => opened.push(u), notify: (n) => notices.push(n) });
	i.notify({ type: "auth_url", url: "https://auth.openai.com/oauth/authorize?x=1", instructions: "A browser window should open." });
	i.notify({ type: "device_code", userCode: "ABCD-1234", verificationUri: "https://auth.x.ai/device" });
	i.notify({ type: "progress", message: "Waiting" });
	assert.deepEqual(opened, ["https://auth.openai.com/oauth/authorize?x=1", "https://auth.x.ai/device"]);
	assert.deepEqual(notices[1], { type: "code", userCode: "ABCD-1234", url: "https://auth.x.ai/device" });
	assert.deepEqual(notices[2], { type: "info", message: "Waiting" });
	assert.equal(await i.prompt({ type: "select", message: "m", options: [{ id: "device_code", label: "d" }, { id: "browser", label: "b" }] }), "browser");

	// no way to ask: the prompt waits, then gives up when pi no longer needs it
	const stop = new AbortController();
	const pending = i.prompt({ type: "manual_code", message: "paste", signal: stop.signal });
	stop.abort();
	await assert.rejects(pending, /cancelled/);

	const asked = interactionFor({ openUrl() {}, notify() {}, ask: async (m) => `reply to ${m}` });
	assert.equal(await asked.prompt({ type: "manual_code", message: "paste" }), "reply to paste");
});

test("engine: not usable until the chosen provider is ready, and a refused run never reaches a model", async () => {
	let key: string | null = null;
	const rt = createPiRuntime({ path: join(tmp, "i.bin"), seal, apiKey: (p) => (p === "anthropic" ? key : null) });
	let selection: { provider: "anthropic" | "xai"; model?: string } = { provider: "anthropic" };
	const engine = createPiEngine({ runtime: async () => rt, selection: () => selection });

	assert.equal(engine.id, "pi");
	const missing = await engine.status();
	assert.deepEqual([missing.ready, missing.canLogin], [false, false]);
	assert.equal(missing.reason, notReadyReason("anthropic"));
	assert.match(missing.reason, /Claude API atslēga/);

	const events: RunEvent[] = [];
	await engine.run({ prompt: "x", runDir: join(tmp, "run"), pluginDir: tmp, mcp: { command: process.execPath, args: ["-e", "process.exit(1)"], env: {} }, signal: new AbortController().signal, onEvent: (e) => events.push(e) });
	assert.deepEqual(events, [{ type: "error", engine: "pi", message: notReadyReason("anthropic") }]);

	key = "sk-ant-app";
	const ready = await engine.status();
	assert.equal(ready.ready, true);
	assert.match(ready.reason, /Claude \(API atslēga\), modelis claude-sonnet-5-5/);
	selection = { provider: "anthropic", model: "claude-opus-5-5" };
	assert.match((await engine.status()).reason, /modelis claude-opus-5-5/);

	selection = { provider: "xai" };
	const xai = await engine.status();
	assert.equal(xai.ready, false);
	assert.match(xai.reason, /Pieslēgties/);
});
