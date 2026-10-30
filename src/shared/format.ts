// Dates and countdowns shown in the top bar and project list. Pure functions, tested.

/** Parses "13.07.2026" or "2026-07-13" (+ optional "10:00") as local time. Returns null if unreadable. */
export function parseDeadline(date: string | null | undefined, time?: string | null): Date | null {
	if (!date) return null;
	let y: number, m: number, d: number;
	const dotted = date.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
	const iso = date.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
	if (dotted) [d, m, y] = [Number(dotted[1]), Number(dotted[2]), Number(dotted[3])];
	else if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
	else return null;
	let hh = 23, mm = 59; // no time given → end of that day, the safer reading for a deadline
	const t = time?.trim().match(/^(\d{1,2})[:.](\d{2})$/);
	if (t) [hh, mm] = [Number(t[1]), Number(t[2])];
	const out = new Date(y, m - 1, d, hh, mm, 0, 0);
	return out.getFullYear() === y && out.getMonth() === m - 1 && out.getDate() === d ? out : null;
}

export interface Countdown {
	text: string;
	/** under 24 h or already passed → shown in the critical colour */
	critical: boolean;
	passed: boolean;
}

export function countdown(deadline: Date | null, now: Date = new Date()): Countdown | null {
	if (!deadline) return null;
	const ms = deadline.getTime() - now.getTime();
	if (ms <= 0) return { text: "termiņš pagājis", critical: true, passed: true };
	const hours = Math.floor(ms / 3_600_000);
	const d = Math.floor(hours / 24);
	const h = hours % 24;
	const text = d > 0 ? `${d}d ${h}h` : hours > 0 ? `${hours}h ${Math.floor((ms % 3_600_000) / 60_000)}min` : `${Math.max(1, Math.floor(ms / 60_000))}min`;
	return { text, critical: ms < 24 * 3_600_000, passed: false };
}

/** "pirms 3 dienām" style, for "mainīts …" in the project list. */
export function ago(iso: string, now: Date = new Date()): string {
	const ms = now.getTime() - new Date(iso).getTime();
	const min = Math.floor(ms / 60_000);
	if (min < 1) return "tikko";
	if (min < 60) return `pirms ${min} min`;
	const h = Math.floor(min / 60);
	if (h < 24) return `pirms ${h} h`;
	const d = Math.floor(h / 24);
	if (d === 1) return "vakar";
	return `pirms ${d} dienām`;
}

export function bytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
	return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
