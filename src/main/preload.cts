// Narrow bridge: the renderer may only call channels on this allowlist.
import { contextBridge, ipcRenderer } from "electron";

const INVOKE = new Set([
	"projects:list", "projects:add", "projects:update", "projects:forget", "projects:summaries",
	"folders:pick", "folders:pickFile", "folders:summary", "folders:open",
	"settings:get", "settings:save", "settings:setClaudeKey",
	"engines:status", "engines:login",
	"pi:providers", "pi:login", "pi:loginAnswer", "pi:loginCancel", "pi:logout",
	"agent:run", "agent:stop", "audit:tail",
	"state:get",
	"files:scan", "files:extract", "files:setKind", "files:text", "files:openOne",
	"tasks:variant", "tasks:confirmVariant",
	"versions:setEditions", "versions:compare", "versions:classify", "versions:setInForce", "versions:readQa", "versions:setQaImpact", "versions:confirmQa", "versions:confirmChange",
	"versions:compareTemplates", "versions:readDeadline", "versions:setDeadline",
	"req:read", "req:confirm", "req:edit", "req:secondPass",
	"registers:get", "registers:save", "registers:import",
	"roles:get", "roles:save", "roles:suggest", "roles:decide",
	"fill:forms", "fill:vocabulary", "fill:bindForm", "fill:setBinding", "fill:confirmBinding", "fill:notApplicable", "fill:generateForm", "fill:techEdit", "fill:techGenerate", "fill:templates", "fill:codeFill", "fill:setItem", "fill:inspect", "fill:preview", "fill:bip", "fill:matrica", "fill:builderCopies", "fill:leaks", "fill:valueSheet", "fill:generate", "fill:techProposal", "fill:techDecision",
	"feasibility:get", "feasibility:save", "mapping:get", "mapping:save", "finance:get", "finance:save",
	"proofs:plan", "proofs:collect",
	"checks:run", "checks:substance", "checks:ack", "checks:code",
	"signatures:get", "signatures:save", "signatures:pick", "eis:tick",
	"closeout:get", "closeout:save", "closeout:addObject", "closeout:postwin", "clarify:draft",
	"deps:status", "grok:update",
	"sources:pick", "sources:add", "sources:refresh", "sources:remove", "sources:note", "sources:open",
]);
const EVENTS = new Set(["agent:event", "files:progress", "task:text", "activity", "pi:login"]);

contextBridge.exposeInMainWorld("konkurss", {
	invoke: (channel: string, ...args: unknown[]) => {
		if (!INVOKE.has(channel)) return Promise.reject(new Error(`Nezināms kanāls: ${channel}`));
		return ipcRenderer.invoke(channel, ...args);
	},
	on: (channel: string, cb: (...args: unknown[]) => void) => {
		if (!EVENTS.has(channel)) throw new Error(`Nezināms notikums: ${channel}`);
		const listener = (_e: unknown, ...args: unknown[]) => cb(...args);
		ipcRenderer.on(channel, listener);
		return () => ipcRenderer.removeListener(channel, listener);
	},
});
