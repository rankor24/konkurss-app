// Wraps an engine so every run reports what it is doing to the side panel. The wrapped run behaves exactly as before.
import { randomUUID } from "node:crypto";
import { describe, progressText, taskTitle, type Activity } from "../shared/activity.js";
import type { Engine } from "./engines/types.js";

export function withActivity(inner: Engine, emit: (a: Activity) => void, projectOfRunDir: (dir: string) => string | null): Engine {
	return {
		id: inner.id,
		status: () => inner.status(),
		login: inner.login ? () => inner.login!() : undefined,
		run(o) {
			const run = randomUUID();
			const project = projectOfRunDir(o.runDir);
			const send = (kind: Activity["kind"], text: string, detail?: string) => emit({ run, project, engine: inner.id, at: new Date().toISOString(), kind, text, detail });
			send("start", taskTitle(o.prompt), o.prompt);
			// what the agent writes between two tool calls is one "answer" block that grows; it is sent in full, at most once a second, and flushed when something else happens
			let answer = "";
			let sentLen = 0;
			let lastSent = 0;
			const flush = () => {
				if (answer.length > sentLen) {
					sentLen = answer.length;
					lastSent = Date.now();
					send("answer", progressText(answer.length), answer);
				}
			};
			return inner.run({
				...o,
				onEvent: (e) => {
					if (e.type === "text") {
						answer += e.text;
						if (Date.now() - lastSent > 1000) flush();
					} else {
						flush();
						answer = "";
						sentLen = 0;
						const d = describe(e);
						if (d) send(d.kind, d.text);
					}
					o.onEvent(e);
				},
			});
		},
	};
}
