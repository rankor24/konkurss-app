// agent-pi — the family's shared agent loop on pi 1.4.
//
// Knows nothing about tenders. Its only ties to the app are the RunEvent type (../shared/types) and the
// McpLaunchSpec it is handed. To reuse it in another app (BIM Crew, the design app), lift this folder and
// give it a RunEvent type with the same shape.
export { PI_PROVIDERS, PI_PROVIDER_IDS, isPiProvider, piProviderInfo, type PiAuthKind, type PiProviderId, type PiProviderInfo } from "./providers.js";
export { PiCredentialStore, DEFAULT_BLOCKED_OAUTH, type PiCredentialOptions, type Seal } from "./credentials.js";
export { createPiRuntime, defaultPiModel, effortsOf, listPiModels, lookupPiModel, piAuthState, streamFn, thinkingFor, type PiAuthState, type PiEffort, type PiIdentity, type PiModelInfo, type PiModelsOptions, type PiRuntime } from "./models.js";
export { interactionFor, loginProvider, logoutProvider, type LoginNotice, type LoginUi } from "./login.js";
export { connectMcpTools, type McpLaunchSpec, type McpTools, type McpToolsOptions } from "./mcp.js";
export { newPiState, piEvents, type PiState } from "./events.js";
export { DEFAULT_MAX_TURNS, DEFAULT_SYSTEM_PROMPT, runPi, type PiRunOptions } from "./run.js";
