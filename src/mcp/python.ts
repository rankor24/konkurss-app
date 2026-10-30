// Runs the skills' own Python extract scripts. Dev: `py -3.14 <script>`.
// Packaged builds set KONKURSS_TOOLS_EXE to the frozen konkurss-tools.exe, which runs the same scripts without Python.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { extname, join } from "node:path";

export interface PyConfig {
	/** Interpreter command, e.g. "py" with args ["-3.14"]. */
	command: string;
	args: string[];
	/** resources/plugin/skills */
	skillsDir: string;
}

export function pyConfigFromEnv(env: NodeJS.ProcessEnv): PyConfig {
	// the packaged app carries the document tools as one exe; its "run-script" command runs a skill script with the libraries it needs
	if (env.KONKURSS_TOOLS_EXE && existsSync(env.KONKURSS_TOOLS_EXE)) return { command: env.KONKURSS_TOOLS_EXE, args: ["run-script"], skillsDir: env.KONKURSS_SKILLS_DIR ?? "" };
	const raw = env.KONKURSS_PY ?? (process.platform === "win32" ? "py -3.14" : "python3");
	const [command, ...args] = raw.split(" ").filter(Boolean);
	return { command, args, skillsDir: env.KONKURSS_SKILLS_DIR ?? "" };
}

/** Which script reads which extension. Same scripts the skills document. */
export function readerFor(skillsDir: string, file: string): { script: string; args: string[] } | null {
	const ext = extname(file).toLowerCase();
	if (ext === ".docx" || ext === ".edoc") return { script: join(skillsDir, "konkurss", "scripts", "extract_docx.py"), args: [file] };
	if (ext === ".pdf") return { script: join(skillsDir, "konkurss", "scripts", "extract_pdf.py"), args: [file] };
	if (ext === ".xlsx") return { script: join(skillsDir, "paraugmodeli", "scripts", "extract_docs.py"), args: [file] };
	return null;
}

export function runPython(cfg: PyConfig, script: string, args: string[], timeoutMs = 120_000): Promise<string> {
	return new Promise((resolvePromise, reject) => {
		execFile(
			cfg.command,
			[...cfg.args, script, ...args],
			{ timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, PYTHONIOENCODING: "utf-8" }, windowsHide: true },
			(err, stdout, stderr) => {
				if (err) reject(new Error(`${err.message}\n${stderr}`.trim()));
				else resolvePromise(stdout);
			},
		);
	});
}
