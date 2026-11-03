// The providers this package offers and how each one signs in. Plain data, no pi imports,
// so the renderer can read it too.

export type PiProviderId = "anthropic" | "openai-codex" | "xai";

export type PiAuthKind = "api_key" | "oauth";

export interface PiProviderInfo {
	id: PiProviderId;
	/** How the person gets access: a key the app stores itself, or a subscription sign-in through pi. */
	auth: PiAuthKind;
	/** Model used when none is chosen. Falls back to the newest model in pi's catalog when pi no longer lists it. */
	defaultModel?: string;
}

export const PI_PROVIDERS: readonly PiProviderInfo[] = [
	// Claude: API key only. Claude.ai subscription OAuth is not allowed for third-party apps.
	{ id: "anthropic", auth: "api_key", defaultModel: "claude-sonnet-5-5" },
	// ChatGPT subscription (Plus/Pro) through pi's OpenAI Codex OAuth.
	{ id: "openai-codex", auth: "oauth" },
	// SuperGrok / X Premium subscription through pi's xAI device-code OAuth.
	{ id: "xai", auth: "oauth" },
];

export const PI_PROVIDER_IDS: readonly PiProviderId[] = PI_PROVIDERS.map((p) => p.id);

export function isPiProvider(x: unknown): x is PiProviderId {
	return typeof x === "string" && (PI_PROVIDER_IDS as readonly string[]).includes(x);
}

export function piProviderInfo(id: PiProviderId): PiProviderInfo {
	return PI_PROVIDERS.find((p) => p.id === id)!;
}
