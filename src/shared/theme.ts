export type Theme = "auto" | "light" | "dark";

export const THEMES: { id: Theme; label: string; title: string }[] = [
	{ id: "auto", label: "Auto", title: "Seko Windows iestatījumam" },
	{ id: "light", label: "Gaišs", title: "Vienmēr gaišs" },
	{ id: "dark", label: "Tumšs", title: "Vienmēr tumšs" },
];

/** Anything that is not a known theme (a missing or hand-edited setting) means "follow the system". */
export function themeOf(value: unknown): Theme {
	return value === "light" || value === "dark" ? value : "auto";
}

/** The value of the `data-theme` attribute on <html>; "auto" has none, so the system's colour scheme decides. */
export function themeAttr(theme: Theme): "light" | "dark" | null {
	return theme === "auto" ? null : theme;
}
