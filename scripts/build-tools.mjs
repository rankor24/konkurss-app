// Freezes python/konkurss_tools.py into build/tools/konkurss-tools/konkurss-tools.exe (PyInstaller, one folder).
// The packaged app prefers this exe, so the colleague's PC needs no Python. Uses an isolated .build-venv.
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const venvPy = join(root, ".build-venv", "Scripts", "python.exe");
const sh = (bin, args) => execFileSync(bin, args, { cwd: root, stdio: "inherit" });

if (!existsSync(venvPy)) {
	sh("py", ["-3.14", "-m", "venv", ".build-venv"]);
	sh(venvPy, ["-m", "pip", "install", "--quiet", "pyinstaller", "python-docx", "openpyxl", "pymupdf==1.27.2.3"]);
}
rmSync(join(root, "build", "tools"), { recursive: true, force: true });
sh(venvPy, [
	"-m", "PyInstaller", "--noconfirm", "--clean", "--onedir", "--console",
	"--name", "konkurss-tools",
	"--distpath", join("build", "tools"),
	"--workpath", join("build", "pyi-work"),
	"--specpath", join("build", "pyi-work"),
	"--collect-all", "docx", "--collect-all", "openpyxl", "--collect-all", "pymupdf", "--collect-all", "fitz",
	"--hidden-import", "lxml._elementpath",
	// stdlib modules the shipped skill scripts import (they are run dynamically, so PyInstaller cannot see them)
	...["argparse", "zipfile", "html", "glob", "base64", "io", "xml.etree.ElementTree", "pathlib", "runpy"].flatMap((m) => ["--hidden-import", m]),
	join("python", "konkurss_tools.py"),
]);
const exe = join(root, "build", "tools", "konkurss-tools", "konkurss-tools.exe");
if (!existsSync(exe)) throw new Error("PyInstaller did not produce " + exe);
console.log("built", exe);
