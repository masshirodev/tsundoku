/**
 * The words of MODE's and LAYOUT's N SERIES DIFFER → list (2A;
 * doc/SETTINGS.md): what the series reads by, its kind, and where it was
 * chosen. A novel kept R→L (c552) says so beside its own layout, or alone
 * when its layout is the default's.
 */

export const MODE_WORD: Record<string, string> = {
	rtl: 'R→L',
	ltr: 'L→R',
	vertical: 'VERTICAL',
	paged: 'PAGED',
	scroll: 'SCROLL'
};

/** One series that differs, as `modeOverrides` (settings-page.ts) gives it. */
export type ModeItem = { kind: string; direction: string | null; rtl: boolean };

export function modeLine(o: ModeItem): string {
	return [
		...(o.direction ? [MODE_WORD[o.direction] ?? o.direction.toUpperCase()] : []),
		...(o.rtl ? [MODE_WORD.rtl] : []),
		o.kind.toUpperCase(),
		'CHOSEN IN THE READER'
	].join(' · ');
}
