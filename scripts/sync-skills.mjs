// Copies the four konkurss skills from Boris's Claude skills folder into
// resources/plugin/ so the app ships the same files Claude Code uses.
// The skills folder stays the single source of truth; this copy is build output.
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SKILLS = ["konkurss", "konkurss-checklist", "paraugmodeli", "lv-doc-tables"];
const source = process.env.KONKURSS_SKILLS_SOURCE ?? join(homedir(), ".claude", "skills");
const target = join(import.meta.dirname, "..", "resources", "plugin");

const missing = SKILLS.filter((s) => !existsSync(join(source, s, "SKILL.md")));
if (missing.length) {
	console.error(`Skills not found in ${source}: ${missing.join(", ")}`);
	process.exit(1);
}

rmSync(target, { recursive: true, force: true });
mkdirSync(join(target, ".claude-plugin"), { recursive: true });
writeFileSync(
	join(target, ".claude-plugin", "plugin.json"),
	JSON.stringify({ name: "konkurss", version: "0.1.0", description: "BŪVDIZAINS konkursu skills" }, null, 2),
);
for (const skill of SKILLS) {
	cpSync(join(source, skill), join(target, "skills", skill), {
		recursive: true,
		filter: (p) => !p.includes("__pycache__"),
	});
}
console.log(`Synced ${SKILLS.length} skills from ${source}`);
