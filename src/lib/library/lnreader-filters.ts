import { EXCLUDE, INCLUDE, IGNORE, type FilterField } from './browse-filters.ts';

/**
 * An LNReader plugin's filters (doc/NOVELS.md) as BROWSE draws them
 * (browse-filters.ts: one drawing for every type), and back. LNReader has
 * five types: Text, Picker (one of several), Switch, Checkbox (several of
 * several) and XCheckbox (each option included, excluded or neither).
 * Fields keep the plugin's order, so the way back goes by position.
 */

type Option = { label: string; value: string };
export type LnFilter =
	| { type: 'Text'; label: string; value: string }
	| { type: 'Picker'; label: string; value: string; options: Option[] }
	| { type: 'Switch'; label: string; value: boolean }
	| { type: 'Checkbox'; label: string; value: string[]; options: Option[] }
	| {
			type: 'XCheckbox';
			label: string;
			value: { include?: string[]; exclude?: string[] };
			options: Option[];
	  };
export type LnFilters = Record<string, LnFilter>;
export type LnValues = Record<string, { type: string; value: unknown }>;

const options = (f: { options?: unknown }): Option[] =>
	Array.isArray(f.options)
		? f.options.filter(
				(o): o is Option => !!o && typeof o.label === 'string' && typeof o.value === 'string'
			)
		: [];

/** The plugin's filters, in its order, drawable; with the key each came from. */
export function lnSchema(raw: unknown): { keys: string[]; schema: FilterField[] } {
	const keys: string[] = [];
	const schema: FilterField[] = [];
	if (!raw || typeof raw !== 'object') return { keys, schema };
	for (const [key, f] of Object.entries(raw as Record<string, Record<string, unknown>>)) {
		if (!f || typeof f !== 'object') continue;
		const name = typeof f.label === 'string' ? f.label : key;
		const opts = options(f);
		let field: FilterField | null = null;
		switch (f.type) {
			case 'Text':
				field = { type: 'text', name, state: typeof f.value === 'string' ? f.value : '' };
				break;
			case 'Switch':
				field = { type: 'checkbox', name, state: f.value === true };
				break;
			case 'Picker': {
				if (!opts.length) break;
				const i = opts.findIndex((o) => o.value === f.value);
				field = { type: 'select', name, values: opts.map((o) => o.label), state: Math.max(0, i) };
				break;
			}
			case 'Checkbox': {
				if (!opts.length) break;
				const on = new Set(Array.isArray(f.value) ? (f.value as string[]) : []);
				field = {
					type: 'group',
					name,
					children: opts.map((o) => ({ type: 'checkbox', name: o.label, state: on.has(o.value) }))
				};
				break;
			}
			case 'XCheckbox': {
				if (!opts.length) break;
				const v = (f.value ?? {}) as { include?: string[]; exclude?: string[] };
				const inc = new Set(v.include ?? []);
				const exc = new Set(v.exclude ?? []);
				field = {
					type: 'group',
					name,
					children: opts.map((o) => ({
						type: 'tristate',
						name: o.label,
						state: inc.has(o.value) ? INCLUDE : exc.has(o.value) ? EXCLUDE : IGNORE
					}))
				};
				break;
			}
		}
		if (field) {
			keys.push(key);
			schema.push(field);
		}
	}
	return { keys, schema };
}

/** The panel's choices as popularNovels' `filters`: `{ key: { type, value } }`. */
export function lnValues(raw: LnFilters, keys: string[], applied: FilterField[]): LnValues {
	const out: LnValues = {};
	keys.forEach((key, i) => {
		const f = raw[key];
		const a = applied[i];
		if (!f || !a) return;
		const opts = 'options' in f ? options(f) : [];
		switch (f.type) {
			case 'Text':
				out[key] = { type: f.type, value: String(a.state ?? '') };
				break;
			case 'Switch':
				out[key] = { type: f.type, value: a.state === true };
				break;
			case 'Picker':
				out[key] = { type: f.type, value: opts[a.state as number]?.value ?? f.value };
				break;
			case 'Checkbox':
				out[key] = {
					type: f.type,
					value: opts.filter((_, j) => a.children?.[j]?.state === true).map((o) => o.value)
				};
				break;
			case 'XCheckbox':
				out[key] = {
					type: f.type,
					value: {
						include: opts.filter((_, j) => a.children?.[j]?.state === INCLUDE).map((o) => o.value),
						exclude: opts.filter((_, j) => a.children?.[j]?.state === EXCLUDE).map((o) => o.value)
					}
				};
				break;
		}
	});
	return out;
}
