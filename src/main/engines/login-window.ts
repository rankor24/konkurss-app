// Opens a visible console window that runs `<bin> <args>` and stays open afterwards,
// so the person can read what the vendor's login prints.
import { spawn } from "node:child_process";
import { basename, dirname } from "node:path";

/**
 * The install folder contains a space ("...\Programs\Konkursu App\..."). Passing the full
 * exe path through `cmd /c start ... cmd /k <path>` loses its quotes on the way, and cmd
 * then tries to run "...\Programs\Konkursu". So the path never travels on the command line:
 * the window starts IN the exe's folder and runs the bare file name, which has no space.
 */
export function openLoginWindow(title: string, bin: string, args: string[]): void {
	const absolute = /^[a-zA-Z]:[\\/]|^\\\\/.test(bin);
	const cwd = absolute ? dirname(bin) : undefined;
	// ".\" is explicit: a bare name is not searched in the current folder when NoDefaultCurrentDirectoryInExePath is set.
	const exe = absolute ? `.\\${basename(bin)}` : bin;
	spawn("cmd.exe", ["/c", "start", title, "cmd", "/k", exe, ...args], { cwd, detached: true, stdio: "ignore" }).unref();
}
