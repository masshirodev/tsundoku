/**
 * A source's settings as its SETTINGS screen draws them (doc/BROWSE.md, "A
 * source's settings"; card c145). The engine describes each as
 * `{ key, <type>: { title, summary, value | valueIndex | values, entries?,
 * entryValues? } }` (doc/EXTENSION-ENGINE.md, "Preferences"); this reads that
 * into one shape per type, and a submitted form back into the value
 * `setPreference` stores, refusing anything that isn't one of the setting's.
 */

type Base = { key: string; title: string; summary: string };

export type Setting =
	| (Base & { type: 'switch' | 'check'; on: boolean })
	| (Base & { type: 'text'; text: string })
	| (Base & { type: 'list'; entries: string[]; index: number })
	| (Base & { type: 'multi'; entries: string[]; entryValues: string[]; chosen: string[] });

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const strs = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);

/**
 * Android writes a list's current entry into its summary as `%s`; the
 * screen says it rather than the placeholder.
 */
function summaryOf(summary: string, current: string): string {
	return summary.includes('%s') ? summary.replaceAll('%s', current).trim() : summary;
}

export function settingOf(p: { key: string } & Record<string, unknown>): Setting | null {
	const type = Object.keys(p).find((k) => k !== 'key');
	const d = (type ? p[type] : null) as Record<string, unknown> | null;
	if (!type || !d || typeof d !== 'object') return null;
	const base = { key: p.key, title: str(d.title) || p.key, summary: str(d.summary) };
	switch (type) {
		case 'switchPreferenceCompat':
		case 'checkBoxPreference':
			return {
				...base,
				type: type === 'switchPreferenceCompat' ? 'switch' : 'check',
				on: d.value === true
			};
		case 'editTextPreference': {
			const text = str(d.value);
			return { ...base, type: 'text', text, summary: summaryOf(base.summary, text) };
		}
		case 'listPreference': {
			const entries = strs(d.entries);
			if (entries.length === 0) return null;
			const i = Number.isInteger(d.valueIndex) ? (d.valueIndex as number) : 0;
			const index = i >= 0 && i < entries.length ? i : 0;
			return {
				...base,
				type: 'list',
				entries,
				index,
				summary: summaryOf(base.summary, entries[index])
			};
		}
		case 'multiSelectListPreference': {
			const entries = strs(d.entries);
			const entryValues = strs(d.entryValues);
			if (entries.length === 0 || entries.length !== entryValues.length) return null;
			const chosen = strs(d.values).filter((v) => entryValues.includes(v));
			return { ...base, type: 'multi', entries, entryValues, chosen };
		}
		default:
			return null;
	}
}

/** A list of up to this many draws as cells; longer, as its value and CHANGE ▾. */
export const CELLS_MAX = 4;

/** A form's answer as the value to store, or null when it isn't one of the setting's. */
export function valueFromForm(
	s: Setting,
	given: string[]
): boolean | string | number | string[] | null {
	switch (s.type) {
		case 'switch':
		case 'check':
			return given[0] === 'true' ? true : given[0] === 'false' ? false : null;
		case 'text':
			return given.length === 1 ? given[0].slice(0, 2000) : null;
		case 'list': {
			const i = Number(given[0]);
			return Number.isInteger(i) && i >= 0 && i < s.entries.length ? i : null;
		}
		case 'multi':
			return given.every((v) => s.entryValues.includes(v)) ? [...new Set(given)] : null;
	}
}
