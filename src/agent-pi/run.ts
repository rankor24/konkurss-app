// One agent run on pi: connect the tool server, build an Agent, stream its events as RunEvents.
//
// Borrowed from BIM Crew apps/server/src/runtime/runtime.ts (runAgent): new Agent({ initialState, streamFn,
// toolExecution }), agent.subscribe, finishTurn for a turn limit, agent.abort on the caller's signal.
// Left out on purpose: sessions, approvals, checkpoints, compaction. A run here is one prompt, and the
// tool server is the only door to files, so there is nothing for a second gate to guard.
import { Agent } from "@earendil-works/pi-agent-core";
import type { Api, Model, MutableModels } from "@earendil-works/pi-ai";
import type { RunEvent } from "../shared/types.js";
import { newPiState, piEvents } from "./events.js";
import { connectMcpTools, type McpLaunchSpec } from "./mcp.js";
import { lookupPiModel, streamFn, thinkingFor, type PiEffort, type PiIdentity } from "./models.js";

export interface PiRunOptions {
	models: MutableModels;
	provider?: string;
	/** Empty = the provider's default model. */
	modelId?: string;
	/** A model already looked up; wins over provider and modelId. */
	model?: Model<Api>;
	prompt: string;
	/** Short standing instructions; the task itself is in `prompt`. */
	systemPrompt?: string;
	mcp: McpLaunchSpec;
	/** Tool names the model may use. */
	allowedTools?: readonly string[];
	signal: AbortSignal;
	onEvent: (e: RunEvent) => void;
	/** Stop after this many model responses (default 60, same as the Grok engine). */
	maxTurns?: number;
	thinking?: PiEffort;
	identity?: PiIdentity;
}

export const DEFAULT_MAX_TURNS = 60;

export const DEFAULT_SYSTEM_PROMPT =
	"You work inside a desktop application. Read and write files only with the tools you are given. Follow the task you are given exactly, and answer in the language the task is written in.";

/** Runs the task to the end. Never throws: every failure is reported as an `error` event with the provider's own text. */
export async function runPi(o: PiRunOptions): Promise<void> {
	const st = newPiState();
	let reported = false;
	const send = (e: RunEvent) => {
		if (e.type === "error") reported = true;
		o.onEvent(e);
	};
	let closeTools: (() => Promise<void>) | undefined;
	try {
		const model = o.model ?? lookupPiModel(o.models, o.provider ?? "", o.modelId);
		const mcp = await connectMcpTools(o.mcp, { allow: o.allowedTools, maxResultChars: 400_000 });
		closeTools = mcp.close;
		if (mcp.missing.length) throw new Error(`The tool server did not offer: ${mcp.missing.join(", ")}`);

		const maxTurns = o.maxTurns ?? DEFAULT_MAX_TURNS;
		const agent = new Agent({
			initialState: {
				systemPrompt: o.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
				model,
				thinkingLevel: o.thinking ?? thinkingFor(model),
				tools: mcp.tools,
				messages: [],
			},
			streamFn: streamFn(o.models),
			// The tools write project data; one at a time keeps two writes from racing.
			toolExecution: "sequential",
			...(o.identity ? { identity: { attribution: { name: o.identity.name, url: o.identity.url } } } : {}),
		});

		let turns = 0;
		agent.finishTurn = async (turn) => {
			// only a turn that called tools would be followed by another one; a final answer is never cut off
			if (++turns >= maxTurns && turn.toolResults.length > 0) {
				send({ type: "error", engine: "pi", message: `Reached the limit of ${maxTurns} steps (max turns).` });
				st.errored = true;
				return { action: "end" };
			}
			return undefined;
		};
		agent.subscribe((ev) => {
			for (const r of piEvents(ev, st)) send(r);
		});

		const stop = () => agent.abort();
		if (o.signal.aborted) stop();
		else o.signal.addEventListener("abort", stop, { once: true });
		try {
			await agent.prompt(o.prompt);
		} finally {
			o.signal.removeEventListener("abort", stop);
		}
		// A failure the stream did not turn into a message still has to reach the person.
		if (!reported && !st.errored && agent.state.errorMessage) send({ type: "error", engine: "pi", message: agent.state.errorMessage });
	} catch (e) {
		if (!reported) send({ type: "error", engine: "pi", message: (e as Error).message });
	} finally {
		await closeTools?.().catch(() => undefined);
	}
}
