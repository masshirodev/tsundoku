/**
 * A source's own filters on its BROWSE page (doc/BROWSE.md, "Filters"; Browse
 * Calls, "One drawing for seven filter types" and "Filters wait for APPLY").
 * The engine describes them (filterSchemaManga, doc/EXTENSION-ENGINE.md); the
 * panel is a GET form, so the URL is where the choices live; and they go back
 * to the engine as the JFilterList its getSearchManga reads, matched by name.
 *
 * Keys: `f<i>` for a top-level filter, `f<i>.<j>` for a group's child, and
 * `f<i>.o` for a sort's order. On the FILTERED tab the URL is the whole form,
 * so a checkbox it doesn't name is off; anything else it doesn't name keeps
 * the source's default.
 */

export type SortState = { index: number; ascending: boolean };

export type FilterField = {
	type: 'select' | 'sort' | 'checkbox' | 'tristate' | 'text' | 'group' | 'header' | 'separator';
	name: string;
	state?: number | boolean | string | SortState | null;
	values?: string[] | null;
	children?: FilterField[] | null;
};

/** One filter as getSearchManga's filterList reads it (the engine's JFilterList). */
export type EngineFilter = {
	name: string;
	type: string;
	stateInt?: number;
	stateString?: string;
	stateSort?: SortState;
	stateList?: { name: string; type: string; stateBoolean?: boolean; stateInt?: number }[];
};

export const IGNORE = 0;
export const INCLUDE = 1;
export const EXCLUDE = 2;

const TEXT_MAX = 200;

/**
 * What a group can hold that can be set. The engine reads a text inside a
 * group from the child's name, which is also how it finds the child, so such a
 * text can never be changed: it isn't drawn (doc/BROWSE.md, "Not done yet").
 */
const settable = (f: FilterField) =>
	f.type === 'checkbox' || f.type === 'tristate' || f.type === 'select';

/** The schema as the engine gave it, with anything malformed dropped rather than drawn wrong. */
export function cleanSchema(raw: unknown): FilterField[] {
	if (!Array.isArray(raw)) return [];
	const field = (f: unknown, inGroup: boolean): FilterField | null => {
		if (!f || typeof f !== 'object') return null;
		const { type, name, state, values, children } = f as Record<string, unknown>;
		if (typeof name !== 'string') return null;
		const labels = Array.isArray(values) ? values.map(String) : null;
		switch (type) {
			case 'header':
			case 'separator':
				return inGroup ? null : { type, name };
			case 'select':
				return labels && labels.length > 0
					? { type, name, values: labels, state: clampInt(state, labels.length - 1) }
					: null;
			case 'tristate':
				return { type, name, state: clampInt(state, EXCLUDE) };
			case 'checkbox':
				return { type, name, state: state === true };
			case 'text':
				return inGroup ? null : { type, name, state: typeof state === 'string' ? state : '' };
			case 'sort': {
				if (inGroup || !labels || labels.length === 0) return null;
				const s = state as Partial<SortState> | null | undefined;
				return {
					type,
					name,
					values: labels,
					state:
						s && Number.isInteger(s.index) && s.index! >= 0 && s.index! < labels.length
							? { index: s.index!, ascending: s.ascending === true }
							: null
				};
			}
			case 'group': {
				if (inGroup || !Array.isArray(children)) return null;
				const kids = children
					.map((c) => field(c, true))
					.filter((c): c is FilterField => c !== null && settable(c));
				return kids.length > 0 ? { type, name, children: kids } : null;
			}
			default:
				return null;
		}
	};
	return raw.map((f) => field(f, false)).filter((f): f is FilterField => f !== null);
}

function clampInt(v: unknown, max: number): number {
	return Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max ? (v as number) : 0;
}

const key = (path: (number | string)[]) => `f${path.join('.')}`;

/** The schema with the URL's choices in it, on the FILTERED tab. */
export function readFilters(schema: FilterField[], params: URLSearchParams): FilterField[] {
	const one = (f: FilterField, path: number[]): FilterField => {
		const k = key(path);
		const v = params.get(k);
		switch (f.type) {
			case 'select':
				return { ...f, state: v === null ? f.state : clampInt(Number(v), f.values!.length - 1) };
			case 'tristate':
				return { ...f, state: v === null ? f.state : clampInt(Number(v), EXCLUDE) };
			case 'checkbox':
				// An unticked box sends nothing, so absence is the answer.
				return { ...f, state: v === '1' };
			case 'text':
				return { ...f, state: v === null ? f.state : v.slice(0, TEXT_MAX) };
			case 'sort': {
				if (v === null) return f;
				const index = Number(v);
				if (!Number.isInteger(index) || index < 0 || index >= f.values!.length) return f;
				return { ...f, state: { index, ascending: params.get(key([...path, 'o'])) === 'a' } };
			}
			case 'group':
				return { ...f, children: f.children!.map((c, j) => one(c, [...path, j])) };
			default:
				return f;
		}
	};
	return schema.map((f, i) => one(f, [i]));
}

/** The choices as URL parameters: what readFilters reads back. Defaults are written too, so the link is the form. */
export function writeFilters(applied: FilterField[]): [string, string][] {
	const out: [string, string][] = [];
	const one = (f: FilterField, path: number[]) => {
		const k = key(path);
		switch (f.type) {
			case 'select':
			case 'tristate':
				out.push([k, String(f.state)]);
				break;
			case 'checkbox':
				if (f.state === true) out.push([k, '1']);
				break;
			case 'text':
				if (f.state) out.push([k, String(f.state)]);
				break;
			case 'sort':
				if (f.state && typeof f.state === 'object') {
					out.push(
						[k, String(f.state.index)],
						[key([...path, 'o']), f.state.ascending ? 'a' : 'd']
					);
				}
				break;
			case 'group':
				f.children!.forEach((c, j) => one(c, [...path, j]));
				break;
		}
	};
	applied.forEach((f, i) => one(f, [i]));
	return out;
}

/** The choices as the engine reads them. Headers and separators carry nothing. */
export function toEngine(applied: FilterField[]): EngineFilter[] {
	const out: EngineFilter[] = [];
	for (const f of applied) {
		switch (f.type) {
			case 'select':
			case 'tristate':
				out.push({ name: f.name, type: f.type, stateInt: f.state as number });
				break;
			case 'text':
				out.push({ name: f.name, type: f.type, stateString: f.state as string });
				break;
			case 'sort':
				if (f.state && typeof f.state === 'object')
					out.push({ name: f.name, type: f.type, stateSort: f.state });
				break;
			case 'checkbox':
				// Upstream reads a top-level checkbox from the first entry of stateList.
				out.push({
					name: f.name,
					type: f.type,
					stateList: [{ name: f.name, type: f.type, stateBoolean: f.state === true }]
				});
				break;
			case 'group':
				out.push({
					name: f.name,
					type: f.type,
					stateList: f.children!.map((c) =>
						c.type === 'checkbox'
							? { name: c.name, type: c.type, stateBoolean: c.state === true }
							: { name: c.name, type: c.type, stateInt: c.state as number }
					)
				});
				break;
		}
	}
	return out;
}

const same = (a: FilterField['state'], b: FilterField['state']) =>
	a === b ||
	(!!a &&
		!!b &&
		typeof a === 'object' &&
		typeof b === 'object' &&
		a.index === b.index &&
		a.ascending === b.ascending);

/** How many choices differ from the source's own: FILTER's count, and "5 ON". */
export function changedCount(schema: FilterField[], applied: FilterField[]): number {
	let n = 0;
	schema.forEach((f, i) => {
		const g = applied[i];
		if (!g) return;
		if (f.type === 'group')
			f.children!.forEach((c, j) => {
				if (!same(c.state, g.children?.[j]?.state)) n++;
			});
		else if (f.type !== 'header' && f.type !== 'separator' && !same(f.state, g.state)) n++;
	});
	return n;
}

/** A group of tri-states as its label counts them: "2 IN · 1 OUT". */
export function groupCount(group: FilterField): string {
	const kids = group.children ?? [];
	const tri = kids.filter((c) => c.type === 'tristate');
	if (tri.length === 0) {
		const on = kids.filter((c) => c.state === true).length;
		return on ? `${on} ON` : '';
	}
	const inc = tri.filter((c) => c.state === INCLUDE).length;
	const exc = tri.filter((c) => c.state === EXCLUDE).length;
	return [inc && `${inc} IN`, exc && `${exc} OUT`].filter(Boolean).join(' · ');
}
