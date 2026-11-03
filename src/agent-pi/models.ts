// The one pi `Models` collection for the app: catalog, auth, streaming.
//
// Borrowed from BIM Crew apps/server/src/runtime/models.ts (getModels / lookupModel / streamFn) and
// model-catalog.ts (effortsOf / defaultEffort). Narrowed to the three providers this package offers.
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type { Api, AssistantMessageEventStream, Model, MutableModels, SimpleStreamOptions, TranscriptContext } from "@earendil-works/pi-ai";
import { PiCredentialStore, type PiCredentialOptions } from "./credentials.js";
import { isPiProvider, piProviderInfo, type PiProviderId } from "./providers.js";

export interface PiIdentity {
	name: string;
	url: string;
}

export interface PiModelsOptions extends PiCredentialOptions {
	/** How requests introduce the app to providers. */
	identity?: PiIdentity;
}

export interface PiRuntime {
	models: MutableModels;
	credentials: PiCredentialStore;
	identity?: PiIdentity;
}

export function createPiRuntime(opts: PiModelsOptions): PiRuntime {
	const credentials = new PiCredentialStore(opts);
	const identity = opts.identity;
	const models = builtinModels({
		credentials,
		// Only what the app stored counts. A colleague's ANTHROPIC_API_KEY or OPENAI_API_KEY in the environment must not silently change which account pays.
		authContext: { env: async () => undefined, fileExists: async () => false },
		...(identity ? { identity: { attribution: { name: identity.name, url: identity.url } } } : {}),
	});
	return { models, credentials, identity };
}

/** Stream function handed to the pi Agent: the Models collection resolves and refreshes auth per provider. */
export function streamFn(models: MutableModels) {
	return async (model: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions): Promise<AssistantMessageEventStream> => models.streamSimple(model, context, options);
}

export interface PiModelInfo {
	id: string;
	name: string;
	reasoning: boolean;
	contextWindow: number;
}

export function listPiModels(models: MutableModels, provider: PiProviderId): PiModelInfo[] {
	return models.getModels(provider).map((m) => ({ id: m.id, name: m.name || m.id, reasoning: m.reasoning, contextWindow: m.contextWindow }));
}

/** The model a provider uses when none is chosen: the provider's default if pi still lists it, else the newest in pi's catalog. */
export function defaultPiModel(models: MutableModels, provider: PiProviderId): string | undefined {
	const list = models.getModels(provider);
	const wanted = piProviderInfo(provider).defaultModel;
	if (wanted && list.some((m) => m.id === wanted)) return wanted;
	return list[list.length - 1]?.id;
}

/** Look a model up, or throw. Same message shape BIM Crew shows. */
export function lookupPiModel(models: MutableModels, provider: string, modelId?: string): Model<Api> {
	if (!isPiProvider(provider)) throw new Error(`Unknown provider "${provider}"`);
	const id = modelId?.trim() || defaultPiModel(models, provider);
	const model = id ? models.getModel(provider, id) : undefined;
	if (!model) throw new Error(`Unknown model "${id ?? ""}" for provider "${provider}"`);
	return model;
}

export type PiEffort = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
const EFFORTS: readonly PiEffort[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/** Effort levels a model really supports: off..high unless its map says null; xhigh and max only when listed. */
export function effortsOf(model: Pick<Model<Api>, "reasoning"> & { thinkingLevelMap?: Record<string, string | null> }): PiEffort[] {
	if (!model.reasoning) return [];
	const map = model.thinkingLevelMap ?? {};
	return EFFORTS.filter((level) => {
		const v = map[level];
		if (v === null) return false;
		if (level === "xhigh" || level === "max") return v !== undefined;
		return true;
	});
}

/** Reading documents wants steady reasoning, not the cheapest and not the longest: medium when the model has it. */
export function thinkingFor(model: Model<Api>): PiEffort {
	const efforts = effortsOf(model as never);
	if (efforts.length === 0) return "off";
	if (efforts.includes("medium")) return "medium";
	return efforts.find((e) => e !== "off") ?? efforts[0];
}

export interface PiAuthState {
	configured: boolean;
	/** "api_key" or "oauth" */
	method?: string;
	/** where pi found it, e.g. "OAuth" or an env var name */
	source?: string;
}

/** Whether a provider can be used right now, without refreshing tokens or calling the network. */
export async function piAuthState(runtime: PiRuntime, provider: PiProviderId): Promise<PiAuthState> {
	try {
		const check = await runtime.models.checkAuth(provider);
		if (!check) return { configured: false };
		// Claude is key-only here: a subscription token for it never counts, even if something wrote one.
		if (check.type === "oauth" && piProviderInfo(provider).auth === "api_key") return { configured: false };
		return { configured: true, method: check.type, source: check.source };
	} catch (e) {
		return { configured: false, source: `error: ${(e as Error).message}` };
	}
}
