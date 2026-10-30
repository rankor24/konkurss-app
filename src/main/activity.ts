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
			const send = (kind: Activity["kind"], text: string) => emit({ run, project, engine: inner.id, at: new Date().toISOString(), kind, text });
			send("start", taskTitle(o.prompt));
			let chars = 0;
			let lastSent = 0;
			return inner.run({
				...o,
				onEvent: (e) => {
					if (e.type === "text") {
						chars += e.text.length;
						if (Date.now() - lastSent > 1500) {
							lastSent = Date.now();
							send("progress", progressText(chars));
						}
					} else {
						const d = describe(e);
						if (d) send(d.kind, d.text);
					}
					o.onEvent(e);
				},
			});
		},
	};
}
