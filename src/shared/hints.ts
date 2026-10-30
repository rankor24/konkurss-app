// Plain-Latvian hints shown NEXT TO a raw provider error — the raw text is never replaced or rewritten (D11).
const RULES: { test: RegExp; hint: string }[] = [
	{
		test: /426|upgrade required|outdated|update required/i,
		hint: "Grok programma ir novecojusi. Atver Iestatījumi un spied „Atjaunināt Grok”, tad mēģini vēlreiz.",
	},
	{
		test: /out of credits|insufficient[_ ]credit|credit balance|usage limit|quota/i,
		hint: "Šī aģenta konta limits ir izsmelts. Izvēlies citu aģentu Iestatījumos vai uzgaidi limita atjaunošanos.",
	},
	{
		test: /401|invalid x-api-key|authentication|not logged in|unauthori[sz]ed/i,
		hint: "Aģents nav pieslēgts vai atslēga nav derīga. Atver Iestatījumi un pieslēdzies no jauna.",
	},
];

export function errorHint(message: string): string | null {
	return RULES.find((r) => r.test.test(message))?.hint ?? null;
}

/** The raw message first, unchanged; the hint on its own line after it. */
export function withHint(message: string): string {
	const h = errorHint(message);
	return h ? `${message}\n→ ${h}` : message;
}
