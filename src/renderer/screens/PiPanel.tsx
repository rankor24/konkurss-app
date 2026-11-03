import { useEffect, useState } from "react";
import { PI_PROVIDER_LABELS, type PiLoginNotice, type PiProviderId, type PiProviderStatus, type Settings } from "../../shared/types";
import { api, errorText } from "../api";

/** The pi agent: which provider and model it uses, and the ChatGPT / SuperGrok sign-in. The Claude key is entered above, with the Claude agent. */
export function PiPanel({ onChange }: { onChange?: () => void }) {
	const [providers, setProviders] = useState<PiProviderStatus[]>([]);
	const [settings, setSettings] = useState<Settings | null>(null);
	/** what the open sign-in window shows: the page or code to use, a progress line, and whether it waits for a pasted address */
	const [login, setLogin] = useState<{ provider: PiProviderId; link?: Extract<PiLoginNotice, { type: "url" | "code" }>; info?: string; asking?: boolean } | null>(null);
	const [paste, setPaste] = useState("");
	const [msg, setMsg] = useState("");

	const refresh = async () => {
		setSettings(await api.settings.get());
		setProviders(await api.pi.providers());
		onChange?.();
	};
	useEffect(() => {
		refresh().catch((e) => setMsg(errorText(e)));
		// what the sign-in needs the person to see arrives while api.pi.login is still waiting
		return api.pi.onLogin((n) =>
			setLogin((cur) => {
				if (!cur || cur.provider !== n.provider) return cur;
				if (n.type === "url" || n.type === "code") return { ...cur, link: n };
				if (n.type === "info") return { ...cur, info: n.message };
				if (n.type === "ask") return { ...cur, asking: true };
				return cur;
			}),
		);
	}, []);

	const chosen: PiProviderId = settings?.piProvider ?? "anthropic";
	const current = providers.find((p) => p.id === chosen);

	const start = async (provider: PiProviderId) => {
		setMsg("");
		setPaste("");
		setLogin({ provider });
		try {
			await api.pi.login(provider);
			setMsg("Pieslēgts.");
		} catch (e) {
			setMsg(errorText(e));
		} finally {
			setLogin(null);
			refresh().catch(() => undefined);
		}
	};
	const cancel = () => void api.pi.loginCancel();
	const submitPaste = async () => {
		await api.pi.loginAnswer(paste);
		setPaste("");
	};
	const logout = async (provider: PiProviderId) => {
		setMsg("");
		try {
			await api.pi.logout(provider);
		} catch (e) {
			setMsg(errorText(e));
		}
		refresh().catch(() => undefined);
	};

	return (
		<div className="card">
			<h2>pi aģents</h2>
			<p className="muted small">Viens aģents, kas strādā ar jebkuru no trim pakalpojumiem. Vēl nav izmēģināts ar īstu konkursu — pirms izmanto, izmēģini vienu uzdevumu.</p>
			<div className="row">
				<label className="field small">
					Pakalpojums
					<select
						value={chosen}
						onChange={async (e) => {
							setSettings(await api.settings.save({ piProvider: e.target.value as PiProviderId }));
							onChange?.();
						}}
					>
						{providers.map((p) => (
							<option key={p.id} value={p.id}>
								{PI_PROVIDER_LABELS[p.id]}
							</option>
						))}
					</select>
				</label>
				<label className="field small">
					Modelis (tukšs = {current?.defaultModel ?? "noklusējums"})
					<input
						key={chosen}
						list="pi-models"
						defaultValue={settings?.piModels?.[chosen] ?? ""}
						style={{ width: 220 }}
						onBlur={async (e) => {
							setSettings(await api.settings.save({ piModels: { ...settings?.piModels, [chosen]: e.target.value.trim() || undefined } }));
							onChange?.();
						}}
					/>
					<datalist id="pi-models">
						{(current?.models ?? []).map((m) => (
							<option key={m.id} value={m.id}>
								{m.name}
							</option>
						))}
					</datalist>
				</label>
			</div>
			{providers.map((p) => (
				<div key={p.id} className="row spread" style={{ borderTop: "1px solid var(--line)", paddingTop: 8 }}>
					<div className="grow">
						<strong>{PI_PROVIDER_LABELS[p.id]}</strong>
						<div className="small" style={{ color: p.configured ? "var(--good)" : "var(--warning)" }}>
							{p.configured ? "● " : "○ "}
							{p.reason}
						</div>
					</div>
					{p.auth === "oauth" && !p.configured && (
						<button disabled={!!login} onClick={() => start(p.id)}>
							Pieslēgties
						</button>
					)}
					{p.auth === "oauth" && p.configured && <button onClick={() => logout(p.id)}>Atteikties</button>}
					{p.auth === "api_key" && <span className="muted small">Atslēgu ievada augstāk, pie Claude.</span>}
				</div>
			))}
			{login && (
				<div className="card" style={{ marginTop: 8 }}>
					<strong>Pieslēgšanās: {PI_PROVIDER_LABELS[login.provider]}</strong>
					{!login.link && !login.info && !login.asking && <div className="small muted">Sagatavo pieslēgšanos…</div>}
					{login.link?.type === "url" && (
						<div className="small">
							Atvērts pārlūks. Pabeidz pieslēgšanos tajā, tad atgriezies šeit.
							<div className="muted" style={{ wordBreak: "break-all" }}>{login.link.url}</div>
						</div>
					)}
					{login.link?.type === "code" && (
						<div className="small">
							Atvērts pārlūks. Ja prasa kodu, ievadi:
							<div style={{ fontSize: 22, letterSpacing: 2, margin: "6px 0" }}>{login.link.userCode}</div>
							<div className="muted" style={{ wordBreak: "break-all" }}>{login.link.url}</div>
						</div>
					)}
					{login.info && <div className="small muted">{login.info}</div>}
					{login.asking && (
						<div className="small">
							Ja pārlūks pēc pieslēgšanās neatgriež šurp, ielīmē adresi no tā adreses joslas:
							<div className="row">
								<input value={paste} onChange={(e) => setPaste(e.target.value)} style={{ width: 380 }} placeholder="http://localhost:1455/auth/callback?code=…" />
								<button disabled={!paste.trim()} onClick={submitPaste}>
									Iesniegt
								</button>
							</div>
						</div>
					)}
					<div className="row">
						<button onClick={cancel}>Atcelt</button>
					</div>
				</div>
			)}
			{msg && <div className="muted small">{msg}</div>}
		</div>
	);
}
