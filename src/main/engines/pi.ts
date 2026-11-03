// pi engine — the app's own agent loop (src/agent-pi) behind the same Engine seam as the three vendor engines.
// This file is the only place that knows both sides: the tender app's settings and Latvian wording on one,
// the app-neutral agent-pi package on the other. pi itself is loaded on first use (about 1.4 s to import).
import { mkdirSync } from "node:fs";
import { PI_PROVIDER_LABELS, type PiLoginNotice, type PiProviderId, type PiProviderStatus } from "../../shared/types.js";
import type { Engine } from "./types.js";
import { KONKURSS_TOOLS } from "./types.js";
import type { LoginNotice, PiRuntime } from "../../agent-pi/index.js";

export interface PiSelection {
	provider: PiProviderId;
	/** empty = the provider's default */
	model?: string;
}

export interface PiDeps {
	/** The runtime is built on first use, so starting the app does not load pi. */
	runtime(): Promise<PiRuntime>;
	selection(): PiSelection;
}

const lib = () => import("../../agent-pi/index.js");

/** What to tell the person when the chosen provider is not usable yet. */
export function notReadyReason(provider: PiProviderId): string {
	return provider === "anthropic"
		? "Nav ievadīta Claude API atslēga (Iestatījumi → Claude)."
		: `Nav pieslēgts. Spied „Pieslēgties” pie ${PI_PROVIDER_LABELS[provider]}.`;
}

/** Status of every provider behind pi, for the settings screen. */
export async function piProviderStatuses(runtime: PiRuntime): Promise<PiProviderStatus[]> {
	const pi = await lib();
	return await Promise.all(
		pi.PI_PROVIDERS.map(async (p): Promise<PiProviderStatus> => {
			const auth = await pi.piAuthState(runtime, p.id);
			return {
				id: p.id,
				configured: auth.configured,
				auth: p.auth,
				reason: auth.configured ? (p.auth === "api_key" ? "API atslēga saglabāta." : "Pieslēgts.") : notReadyReason(p.id),
				models: pi.listPiModels(runtime.models, p.id).map((m) => ({ id: m.id, name: m.name })),
				defaultModel: pi.defaultPiModel(runtime.models, p.id) ?? null,
			};
		}),
	);
}

export function createPiEngine(deps: PiDeps): Engine {
	return {
		id: "pi",
		async status() {
			const { provider, model } = deps.selection();
			const pi = await lib();
			const runtime = await deps.runtime();
			const auth = await pi.piAuthState(runtime, provider);
			if (!auth.configured) return { id: "pi", ready: false, reason: notReadyReason(provider), canLogin: false };
			const shown = model || pi.defaultPiModel(runtime.models, provider) || "—";
			return { id: "pi", ready: true, reason: `${PI_PROVIDER_LABELS[provider]}, modelis ${shown}.`, canLogin: false };
		},
		async run(o) {
			const sel = deps.selection();
			try {
				const pi = await lib();
				const runtime = await deps.runtime();
				const auth = await pi.piAuthState(runtime, sel.provider);
				if (!auth.configured) {
					o.onEvent({ type: "error", engine: "pi", message: notReadyReason(sel.provider) });
					return;
				}
				mkdirSync(o.runDir, { recursive: true });
				await pi.runPi({
					models: runtime.models,
					provider: sel.provider,
					modelId: o.model || sel.model,
					prompt: o.prompt,
					mcp: o.mcp,
					// the same nine tools as every engine; the tool server is the only way to touch files
					allowedTools: KONKURSS_TOOLS,
					signal: o.signal,
					onEvent: o.onEvent,
					identity: runtime.identity,
				});
			} catch (e) {
				o.onEvent({ type: "error", engine: "pi", message: (e as Error).message });
			}
		},
	};
}

/**
 * One sign-in at a time. The window sends what the person must see through `emit`; a pasted answer
 * comes back through `answer`. Cancelling aborts pi's flow, which also closes its local callback server.
 */
export class PiLogin {
	private abort: AbortController | null = null;
	private pending: { resolve(text: string): void; reject(e: Error): void } | null = null;

	constructor(
		private readonly deps: { runtime(): Promise<PiRuntime>; emit(n: PiLoginNotice): void; openUrl(url: string): void },
	) {}

	get busy(): boolean {
		return this.abort !== null;
	}

	async login(provider: PiProviderId): Promise<void> {
		if (this.abort) throw new Error("Pieslēgšanās jau notiek.");
		const abort = new AbortController();
		this.abort = abort;
		const { emit } = this.deps;
		try {
			const pi = await lib();
			const runtime = await this.deps.runtime();
			await pi.loginProvider(
				runtime.models,
				provider,
				{
					openUrl: (url) => this.deps.openUrl(url),
					notify: (n: LoginNotice) => emit(n.type === "url" ? { provider, type: "url", url: n.url } : { ...n, provider }),
					ask: (message, signal) =>
						new Promise<string>((resolve, reject) => {
							this.pending = { resolve, reject };
							signal?.addEventListener("abort", () => reject(new Error("Pieslēgšanās atcelta.")), { once: true });
							emit({ provider, type: "ask", message });
						}),
				},
				abort.signal,
			);
			emit({ provider, type: "done" });
		} catch (e) {
			// pi's own wording, as for every provider error
			emit({ provider, type: "error", message: (e as Error).message });
			throw e;
		} finally {
			this.abort = null;
			this.pending = null;
		}
	}

	answer(text: string): void {
		this.pending?.resolve(text);
		this.pending = null;
	}

	cancel(): void {
		this.pending?.reject(new Error("Pieslēgšanās atcelta."));
		this.pending = null;
		this.abort?.abort();
	}
}
