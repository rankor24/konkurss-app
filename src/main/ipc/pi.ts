// IPC for the pi engine: which providers are usable, and signing in to the ChatGPT / SuperGrok subscriptions.
// The Claude key is entered the same way as before (settings:setClaudeKey); pi reads it from the same store.
import { ipcMain, shell } from "electron";
import { isPiProvider } from "../../agent-pi/providers.js";
import type { AppContext } from "../context.js";
import { PiLogin, piProviderStatuses } from "../engines/pi.js";

function providerOf(x: unknown) {
	if (!isPiProvider(x)) throw new Error("Nezināms pakalpojums.");
	return x;
}

export function registerPi(ctx: AppContext): void {
	const login = new PiLogin({
		runtime: () => ctx.pi(),
		emit: (n) => ctx.emit("pi:login", n),
		// the sign-in pages are https; anything else pi hands over is not opened
		openUrl: (url) => {
			if (/^https:\/\//i.test(url)) void shell.openExternal(url);
		},
	});

	ipcMain.handle("pi:providers", async () => piProviderStatuses(await ctx.pi()));
	ipcMain.handle("pi:login", (_e, provider: unknown) => login.login(providerOf(provider)));
	ipcMain.handle("pi:loginAnswer", (_e, text: string) => login.answer(String(text ?? "")));
	ipcMain.handle("pi:loginCancel", () => login.cancel());
	ipcMain.handle("pi:logout", async (_e, provider: unknown) => {
		const id = providerOf(provider);
		const pi = await import("../../agent-pi/index.js");
		await pi.logoutProvider((await ctx.pi()).models, id);
	});
}
