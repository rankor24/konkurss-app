// Path guard: the one place that decides whether a file may be read or written.
// Every tool in the konkurss-tools server calls this before touching disk, so the
// rules hold no matter which engine (Claude, Codex, Grok) asked.
//
// Rules (mistake catalogue A6, A10 and plan D10):
//  - reads are allowed only inside the configured read folders or the write folder
//  - writes are allowed only inside the write folder
//  - the source folder (izejas dati) is never written, even if it sits inside the write folder
//  - .edoc files are never written
//  - nothing is ever deleted (there is no delete tool at all)

import { isAbsolute, relative, resolve, extname } from "node:path";

export interface GuardConfig {
	readDirs: string[];
	writeDir: string;
}

export type GuardResult = { ok: true; path: string } | { ok: false; reason: string };

/** Windows paths compare case-insensitively. */
function norm(p: string): string {
	const r = resolve(p);
	return process.platform === "win32" ? r.toLowerCase() : r;
}

/** True when `child` is `parent` itself or somewhere below it. */
export function isInside(child: string, parent: string): boolean {
	const rel = relative(norm(parent), norm(child));
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function checkRead(cfg: GuardConfig, rawPath: string): GuardResult {
	if (!rawPath || typeof rawPath !== "string") return { ok: false, reason: "Nav norādīts ceļš." };
	const path = resolve(rawPath);
	const allowed = [...cfg.readDirs, cfg.writeDir].some((d) => isInside(path, d));
	if (!allowed) return { ok: false, reason: `Ārpus konkursa mapēm: ${path}` };
	return { ok: true, path };
}

export function checkWrite(cfg: GuardConfig, rawPath: string): GuardResult {
	if (!rawPath || typeof rawPath !== "string") return { ok: false, reason: "Nav norādīts ceļš." };
	const path = resolve(rawPath);
	if (!isInside(path, cfg.writeDir)) {
		return { ok: false, reason: `Rakstīt drīkst tikai izvades mapē (${cfg.writeDir}). Pieprasīts: ${path}` };
	}
	// A source folder nested inside the output folder stays read-only. (The reverse —
	// output nested inside the source root — is allowed: the deeper folder wins.)
	if (cfg.readDirs.some((d) => isInside(path, d) && !isInside(cfg.writeDir, d))) {
		return { ok: false, reason: `Izejas datu mapi app nekad nemaina: ${path}` };
	}
	if (extname(path).toLowerCase() === ".edoc") {
		return { ok: false, reason: "Parakstītus .edoc failus app neveido un nelabo." };
	}
	return { ok: true, path };
}
