// Dev helper: starts konkurss-tools from the packaged app (inside app.asar, on Electron's Node) the same way the
// engines do, and proves that reading a PDF, a docx and a signed .edoc works WITHOUT Python on the PC:
// KONKURSS_PY points at a command that does not exist, only the frozen konkurss-tools.exe can answer.
//   node --import tsx scripts/packaged-mcp-check.mts "<tender folder>"
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const folder = process.argv[2];
if (!folder) throw new Error("usage: packaged-mcp-check.mts <tender folder>");
const app = resolve(import.meta.dirname, "..", "release", "win-unpacked");
const exe = join(app, "Konkursu App.exe");
const res = join(app, "resources");
const frozen = join(res, "tools", "konkurss-tools", "konkurss-tools.exe");
if (!existsSync(frozen)) throw new Error("frozen tools missing in the package: " + frozen);

const client = new Client({ name: "packaged-check", version: "0" });
await client.connect(
	new StdioClientTransport({
		command: exe,
		args: [join(res, "app.asar", "dist", "mcp", "server.js")],
		env: {
			...(process.env as Record<string, string>),
			ELECTRON_RUN_AS_NODE: "1",
			KONKURSS_PY: "no-such-python-here",
			KONKURSS_TOOLS_EXE: frozen,
			KONKURSS_READ_DIRS: folder,
			KONKURSS_WRITE_DIR: join(app, "..", "check-out"),
			KONKURSS_SKILLS_DIR: join(res, "plugin", "skills"),
		},
	}),
);
console.log("tools:", (await client.listTools()).tools.map((t) => t.name).join(", "));
const walk = (d: string, o: string[] = []): string[] => {
	for (const e of readdirSync(d, { withFileTypes: true })) (e.isDirectory() ? walk(join(d, e.name), o) : o.push(join(d, e.name)));
	return o;
};
const all = walk(folder);
for (const ext of [".docx", ".pdf", ".edoc"]) {
	const f = all.find((x) => x.toLowerCase().endsWith(ext));
	if (!f) {
		console.log(ext, "no file in this folder");
		continue;
	}
	const r = (await client.callTool({ name: "read_doc", arguments: { path: f } })) as { content: { text: string }[]; isError?: boolean };
	console.log(ext, r.isError ? "FAIL: " + r.content[0].text.slice(0, 200) : `ok, ${r.content[0].text.length} chars`);
}
await client.close();
