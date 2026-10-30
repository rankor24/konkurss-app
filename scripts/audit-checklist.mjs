// Final audit helper: every file named in a checklist row's Evidence must exist, and every test title fragment
// quoted after "›" must appear in that test file. Prints rows that fail the cross-check, plus the status totals.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const rows = readFileSync(join(root, "docs", "CHECKLIST.md"), "utf8")
	.split("\n")
	.filter((l) => /^\| \d+\.\d+ \|/.test(l));
const walk = (d, o = []) => {
	for (const n of readdirSync(d)) {
		if (["node_modules", "dist", "release", "build", ".build-venv", ".git"].includes(n)) continue;
		const p = join(d, n);
		statSync(p).isDirectory() ? walk(p, o) : o.push(p);
	}
	return o;
};
const all = walk(root);
const byBase = new Map(all.map((p) => [p.split(/[\\/]/).pop(), p]));
const problems = [];
const totals = {};
for (const row of rows) {
	const cols = row.split(" | ");
	const id = cols[0].replace("| ", "");
	const status = cols[3];
	totals[status] = (totals[status] ?? 0) + 1;
	const evidence = cols.slice(4).join(" | ");
	if (status === "✅" && evidence.replace(/[|\s]/g, "").length < 20) problems.push(`${id}: ✅ without evidence`);
	for (const m of evidence.matchAll(/`([^`]+\.(?:test\.tsx?|mts|mjs|md|ts|tsx|py|yml))`/g)) {
		const base = m[1].split(/[\\/]/).pop();
		if (!byBase.has(base) && !existsSync(join(root, m[1]))) problems.push(`${id}: file not found: ${m[1]}`);
	}
	for (const m of evidence.matchAll(/`([^`]+\.test\.tsx?)`\s*›\s*([^;.`]+)/g)) {
		const f = byBase.get(m[1]);
		if (!f) continue;
		const frag = m[2].trim().split(/[:,(]/)[0].trim().slice(0, 28).toLowerCase();
		if (frag.length > 5 && !readFileSync(f, "utf8").toLowerCase().includes(frag)) problems.push(`${id}: "${frag}" not found in ${m[1]}`);
	}
}
console.log("rows:", rows.length, JSON.stringify(totals));
console.log(problems.length ? problems.join("\n") : "cross-check: no problems");
