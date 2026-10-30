// Append-only audit log: every tool call, allowed or denied, one JSON line each.
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface AuditEntry {
	tool: string;
	path?: string;
	ok: boolean;
	reason?: string;
	engine?: string;
}

export function audit(file: string | undefined, entry: AuditEntry): void {
	if (!file) return;
	try {
		mkdirSync(dirname(file), { recursive: true });
		appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n", "utf8");
	} catch {
		// The log must never break a tool call.
	}
}
