// IPC for phase 8: the tender profile (read in code from the extracted texts) and the pack manifest.
import { existsSync, readdirSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { ipcMain } from "electron";
import type { StatementTemplate } from "../../shared/library.js";
import { packReadiness, recipientFolder } from "../../shared/pack.js";
import { identityInFolder } from "../checks/identity.js";
import { anonymityInFolder } from "../checks/anonymity.js";
import { nextVersionPath, safeName } from "../fill/run.js";
import { isBuilderFolder } from "../library/harvest.js";
import { fillTemplate, statementBlocks, templateFromDocument, type FillContext } from "../library/statements.js";
import { readDocx } from "../office.js";
import { generatedKey } from "../pack/manifest.js";
import { toolsConfig, writeDocx } from "../pytools.js";
import { builderFor } from "../v1/forms.js";
import type { TenderProfile } from "../../shared/profile.js";
import { variantFor } from "../../shared/profile.js";
import type { DocKind } from "../../shared/state.js";
import type { AppContext } from "../context.js";
import { readCachedText } from "../extract.js";
import { assemblePack, buildManifest, manifestFromFolder, withStatus } from "../pack/manifest.js";
import { proposeProfile, type TextDoc } from "../profile.js";
import { updateState } from "../project-state.js";
import { evidencePlanFor } from "../v1/evidence.js";

const PRIORITY: Partial<Record<DocKind, number>> = { nolikums: 0, iub: 1, grozijumi: 2, tehniska_specifikacija: 3, pu: 4, pieteikums: 5 };

/** Folder names inside the source folder, two levels deep (EIS puts each daļa in its own folder). */
function folderNames(dir: string): string[] {
	const out: string[] = [];
	const walk = (d: string, depth: number) => {
		let es;
		try {
			es = readdirSync(d, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of es) {
			if (!e.isDirectory()) continue;
			out.push(e.name);
			if (depth < 1) walk(join(d, e.name), depth + 1);
		}
	};
	walk(dir, 0);
	return out;
}

const PH_LABEL: Record<string, string> = { "tender:id": "konkursa ID (3. solis)", "tender:subject": "iepirkuma priekšmets (3. solis)", "builder:name": "būvnieka nosaukums", "builder:regNr": "būvnieka reģ. Nr.", "who:name": "speciālista vārds", "who:cert": "sertifikāta Nr.", "who:role": "loma līguma izpildē" };

export function registerPack(ctx: AppContext, toolsScript: string): void {
	const tools = toolsConfig(process.env, toolsScript);

	// ----- standard statements (library) -----
	ipcMain.handle("statements:list", () => ctx.store.registers().statements ?? []);
	ipcMain.handle("statements:fromFile", (_e, path: string, kind: StatementTemplate["kind"]) => {
		try {
			const reg = ctx.store.registers();
			const { template, residue } = templateFromDocument(readDocx(path).paragraphs, kind, path, reg);
			reg.statements = [...(reg.statements ?? []), template];
			ctx.store.saveRegisters(reg);
			return { ok: true, template, residue };
		} catch (err) {
			return { ok: false, error: err instanceof Error ? err.message : String(err) };
		}
	});
	ipcMain.handle("statements:save", (_e, list: StatementTemplate[]) => {
		const reg = ctx.store.registers();
		reg.statements = list;
		ctx.store.saveRegisters(reg);
		return list;
	});

	ipcMain.handle("pack:generate", async (_e, projectId: string, itemId: string) => {
		const p = ctx.project(projectId);
		const s = ctx.state(projectId);
		const reg = ctx.store.registers();
		const { manifest: m } = manifest(projectId);
		const it = m.items.find((x) => x.id === itemId);
		if (!it || it.source !== "generated") return { ok: false, error: "Šo dokumentu no standarta teksta neveido." };
		if (it.ref.startsWith("firm:")) return { ok: false, error: `Šo apliecinājumu sagatavo un paraksta pats apakšuzņēmējs (${it.ref.slice(5)}). App to neraksta viņa vārdā.` };
		const kind: StatementTemplate["kind"] = it.ref.startsWith("specialist:") ? "specialista_apliecinajums" : "apaksuznemeja_apliecinajums";
		const t = (reg.statements ?? []).find((x) => x.kind === kind);
		if (!t) return { ok: false, error: "Reģistros nav standarta teksta šim apliecinājumam — pievieno to (Reģistri › Teksti) no kāda jau iesniegta apliecinājuma." };
		const builderName = recipientFolder(it.recipient);
		const builder = builderName ? builderFor(builderName, reg.builders) : undefined;
		if (builderName && !builder) return { ok: false, error: `Būvnieks „${builderName}” nav būvnieku reģistrā (Reģistri › Būvnieki).` };
		let who: FillContext["who"];
		if (it.ref.startsWith("specialist:")) {
			const sp = reg.specialists.find((x) => x.id === it.ref.slice(11));
			const idx = Object.entries(s.choices.specialists).find(([, v]) => v === sp?.id)?.[0];
			who = { specialist: sp, role: idx !== undefined ? (s.requirements.specialisti[Number(idx)]?.field.value ?? undefined) : undefined };
		}
		const { paragraphs, missing } = fillTemplate(t, { reg, req: s.requirements, builder, who, today: new Date() });
		if (missing.length) return { ok: false, error: `Nevar izveidot — trūkst: ${missing.map((x) => PH_LABEL[x] ?? x).join(", ")}.` };
		const dir = join(p.outputDir, "Iesniedzamie", builderName ? safeName(builderName) : "");
		const dst = nextVersionPath(dir, safeName(basename(it.fileName, extname(it.fileName))), ".docx");
		try {
			await writeDocx(tools, { dst, blocks: statementBlocks(paragraphs) });
		} catch (err) {
			return { ok: false, error: err instanceof Error ? err.message : String(err) };
		}
		updateState(p.outputDir, (st) => void (st.generated = { ...st.generated, [generatedKey(it.recipient, it.ref, it.number)]: dst }));
		return { ok: true, file: dst };
	});

	ipcMain.handle("pack:anonymity", (_e, projectId: string) => {
		const p = ctx.project(projectId);
		const reg = ctx.store.registers();
		const sibling = resolve(p.sourceDir, "..", "IESNIEDZAMIE");
		const dirs = [join(p.outputDir, "Paka"), ...(existsSync(sibling) && sibling.toLowerCase() !== resolve(p.outputDir).toLowerCase() ? [sibling] : [])].filter((d) => existsSync(d));
		const runs = dirs.map((d) => anonymityInFolder(d, reg));
		return { problems: runs.flatMap((r) => r.problems), devize: runs.find((r) => r.devize)?.devize ?? null, checked: runs.reduce((n, r) => n + r.checked, 0), unread: runs.flatMap((r) => r.unread), dirs };
	});

	/** Vispārīgā vienošanās mini-tenders: take over the choices, roles and profile of an earlier tender. */
	ipcMain.handle("projects:inherit", (_e, projectId: string, fromId: string) => {
		const from = ctx.state(fromId);
		updateState(ctx.project(projectId).outputDir, (st) => {
			st.choices = structuredClone(from.choices);
			st.roles = structuredClone(from.roles);
			if (from.profile) st.profile = { ...structuredClone(from.profile), confirmed: false, readAt: new Date().toISOString() };
			st.inheritedFrom = { projectId: fromId, at: new Date().toISOString() };
		});
		return ctx.state(projectId);
	});

	ipcMain.handle("pack:identityFolder", (_e, projectId: string) => {
		const p = ctx.project(projectId);
		const reg = ctx.store.registers();
		const sibling = resolve(p.sourceDir, "..", "IESNIEDZAMIE");
		const dirs = [join(p.outputDir, "Paka"), ...(existsSync(sibling) && sibling.toLowerCase() !== resolve(p.outputDir).toLowerCase() ? [sibling] : [])].filter((d) => existsSync(d));
		const problems = dirs.flatMap((d) => identityInFolder(d, reg, p.builders, isBuilderFolder).problems);
		const checked = dirs.reduce((n, d) => n + identityInFolder(d, reg, p.builders, isBuilderFolder).checked, 0);
		return { problems, checked, dirs };
	});

	ipcMain.handle("profile:read", (_e, projectId: string) => {
		const p = ctx.project(projectId);
		const s = ctx.state(projectId);
		const docs: TextDoc[] = [];
		for (const f of s.files) {
			if (f.root !== "source" || f.text !== "ok") continue;
			const text = readCachedText(p, f);
			if (text) docs.push({ file: f.rel, text, priority: PRIORITY[f.kind] ?? 9 });
		}
		if (docs.length === 0) return { ok: false, error: "Vispirms 1. solī nolasi dokumentu tekstu — konkursa kārtību app nosaka no nolikuma teksta." };
		const profile = proposeProfile(docs, folderNames(p.sourceDir), p.builders);
		updateState(p.outputDir, (st) => void (st.profile = profile));
		return { ok: true, profile };
	});

	ipcMain.handle("profile:save", (_e, projectId: string, profile: TenderProfile) => {
		const p = ctx.project(projectId);
		updateState(p.outputDir, (st) => {
			st.profile = profile;
			// a confirmed profile also settles the variant that BIP and roles still read — unless a person chose it already
			if (profile.confirmed && !st.variant?.confirmed) st.variant = { value: variantFor(profile), status: "manual", confirmed: true, note: "No konkursa profila." };
		});
		if (profile.confirmed) ctx.store.updateProject(projectId, { variant: variantFor(profile) });
		return ctx.state(projectId).profile;
	});

	const manifest = (projectId: string) => {
		const p = ctx.project(projectId);
		const s = ctx.state(projectId);
		const reg = ctx.store.registers();
		const m = buildManifest({ state: s, registers: reg, builders: p.builders, profile: s.profile, evidence: evidencePlanFor(s, reg) });
		return { manifest: withStatus(m, join(p.outputDir, "Paka")), packDir: join(p.outputDir, "Paka") };
	};
	ipcMain.handle("pack:get", (_e, projectId: string) => {
		const view = manifest(projectId);
		const p = ctx.project(projectId);
		const s = ctx.state(projectId);
		// where the person moves the finished pack: the tender folder's IESNIEDZAMIE (the app never writes there)
		const tenderDir = /^konkurss$/i.test(basename(p.sourceDir)) ? resolve(p.sourceDir, "..") : resolve(p.sourceDir);
		const targetDir = join(tenderDir, "IESNIEDZAMIE");
		const run = s.checks as { ranAt: string; findings: { id: string; status: string }[] } | undefined;
		const ack = (s.checkAck as Record<string, true> | undefined) ?? {};
		const check = run ? { ranAt: run.ranAt, failsOpen: run.findings.filter((f) => f.status === "fail" && !ack[f.id]).length } : null;
		const places = { workDir: p.outputDir, tenderDir, targetDir, targetExists: existsSync(targetDir), readiness: packReadiness(view.manifest, check) };
		// a pack started by hand next to the tender documents is shown too, so nothing done earlier is lost from sight
		const sibling = resolve(p.sourceDir, "..", "IESNIEDZAMIE");
		const hand = existsSync(sibling) && sibling.toLowerCase() !== resolve(p.outputDir).toLowerCase() ? sibling : null;
		return { ...view, ...places, existing: hand ? manifestFromFolder(hand) : [], existingDir: hand };
	});
	ipcMain.handle("pack:assemble", (_e, projectId: string) => {
		const p = ctx.project(projectId);
		const { manifest: m } = manifest(projectId);
		const r = assemblePack(m, p.outputDir);
		updateState(p.outputDir, (st) => void (st.pack = withStatus(m, join(p.outputDir, "Paka"))));
		return { ok: true, ...r };
	});
}
