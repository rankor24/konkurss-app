// Dev helper: starts konkurss-tools from the packaged app (inside app.asar, on
// Electron's Node) the same way the engines do, and lists its tools.
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const app = resolve(import.meta.dirname, "..", "release", "win-unpacked");
const exe = join(app, "Konkursu App.exe");
const res = join(app, "resources");
const client = new Client({ name: "packaged-check", version: "0" });
await client.connect(new StdioClientTransport({
	command: exe,
	args: [join(res, "app.asar", "dist", "mcp", "server.js")],
	env: { ...(process.env as Record<string, string>), ELECTRON_RUN_AS_NODE: "1",
		KONKURSS_READ_DIRS: process.argv[2], KONKURSS_WRITE_DIR: join(app, "..", "check-out"),
		KONKURSS_SKILLS_DIR: join(res, "plugin", "skills") },
}));
console.log("tools:", (await client.listTools()).tools.map((t) => t.name).join(", "));
const r = await client.callTool({ name: "get_skill", arguments: { skill: "paraugmodeli" } }) as { content: { text: string }[]; isError?: boolean };
console.log("get_skill from extraResources:", r.isError ? "FAIL" : r.content[0].text.split("\n")[1]);
await client.close();
