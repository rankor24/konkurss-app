// Wraps an engine so every run reports what it is doing to the side panel. The wrapped run behaves exactly as before.
import { randomUUID } from "node:crypto";
import { describe, progressText, taskTitle, thinkingLine, toolKind, type Activity } from "../shared/activity.js";
import type { Engine } from "./engines/types.js";

/** Reasoning and answer text arrive in pieces; one block of each kind grows in place instead of making a line per piece. */
interface Block {
	kind: "thinking" | "answer";
	step: string;
	text: string;
	sent: number;
	lastSent: number;
}

interface Call {
	step: string;
	name: string;
	kind: NonNullable<Activity["tool"]>;
	text: string;
	input?: string;
	done: boolean;
}

export function withActivity(inner: Engine, emit: (a: Activity) => void, projectOfRunDir: (dir: string) => string | null): Engine {
	return {
		id: inner.id,
		status: () => inner.status(),
		login: inner.login ? () => inner.login!() : undefined,
		run(o) {
			const run = randomUUID();
			const project = projectOfRunDir(o.runDir);
			const send = (kind: Activity["kind"], text: string, more: Partial<Activity> = {}) => emit({ run, project, engine: inner.id, at: new Date().toISOString(), kind, text, ...more });
			send("start", taskTitle(o.prompt), { detail: o.prompt });

			// a block is sent in full, at most once a second, and flushed when something else happens
			let block: Block | null = null;
			const flush = () => {
				if (block && block.text.length > block.sent) {
					block.sent = block.text.length;
					block.lastSent = Date.now();
					send(block.kind, block.kind === "answer" ? progressText(block.text.length) : thinkingLine(block.text), { detail: block.text, step: block.step });
				}
			};
			const grow = (kind: Block["kind"], text: string) => {
				if (block && block.kind !== kind) {
					flush();
					block = null;
				}
				block ??= { kind, step: randomUUID(), text: "", sent: 0, lastSent: 0 };
				block.text += text;
				if (Date.now() - block.lastSent > 1000) flush();
			};
			const close = () => {
				flush();
				block = null;
			};

			const calls = new Map<string, Call>();
			let anonymous = 0;
			const body = (c: Call, result?: string) => [c.input, result].filter(Boolean).join("\n\n→ ") || undefined;

			return inner.run({
				...o,
				onEvent: (e) => {
					if (e.type === "text") grow("answer", e.text);
					else if (e.type === "thinking") grow("thinking", e.text);
					else {
						close();
						if (e.type === "turn") send("turn", `Gājiens ${e.n}`);
						else if (e.type === "tool") {
							const d = describe(e)!;
							const call: Call = { step: randomUUID(), name: e.name, kind: toolKind(e.name, e.kind), text: d.text, input: e.detail, done: false };
							calls.set(e.id ?? `call-${++anonymous}`, call);
							send("tool", call.text, { step: call.step, tool: call.kind, status: "running", detail: body(call) });
						} else if (e.type === "tool_result") {
							// the result updates the call it answers; a result with nothing to answer is shown only when it failed
							const call = (e.id ? calls.get(e.id) : undefined) ?? [...calls.values()].reverse().find((c) => c.name === e.name && !c.done);
							if (call) {
								call.done = true;
								send("tool", e.ok ? call.text : `${call.text} — neizdevās`, { step: call.step, tool: call.kind, status: e.ok ? "ok" : "failed", detail: body(call, e.ok ? e.output : e.detail ?? e.output) });
							} else {
								const d = describe(e);
								if (d) send(d.kind, d.text);
							}
						} else {
							const d = describe(e);
							if (d) send(d.kind, d.text);
						}
					}
					o.onEvent(e);
				},
			});
		},
	};
}
