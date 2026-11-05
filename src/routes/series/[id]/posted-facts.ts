/**
 * The facts an UNDO band posts back, read before anything is written (c585;
 * doc/SERIES.md, "UNDO's facts").
 *
 * A band carries what its action did as JSON in a hidden field, and the UNDO
 * posts it back. Whatever arrives is a claim: a stale page, a hand-made form
 * or a truncated field can send anything. So each reader here parses inside
 * its own guard, checks the shape field by field (a missing number would
 * reach SQLite as `undefined` and be a 500, not a refusal), and checks the
 * facts are this screen's own series: the series screen undoes what was done
 * to the series it shows, never one the facts name elsewhere. Any failure is
 * `null`, which the action answers as 400 NOTHING TO UNDO with nothing
 * written. Facts that are well formed and this series' own, but describe a
 * library that has moved on (a Work ended or made since), are the writers'
 * to refuse (`putBack`, `locate`, c308), as before.
 */
import type { AddFacts, EndedWork, TakeOutFacts, WorkRecord } from '$lib/server/works';
import type { SeriesRenameFacts } from '$lib/server/series';

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const optStr = (v: unknown) => v === undefined || isStr(v);
const ORDERS: readonly string[] = ['hand', 'added', 'title'];

/** The posted field as JSON, or `undefined` when it is missing or not JSON. */
export function parsePosted(posted: FormDataEntryValue | null): unknown {
	if (typeof posted !== 'string') return undefined;
	try {
		return JSON.parse(posted) as unknown;
	} catch {
		return undefined;
	}
}

function workRecord(v: unknown): WorkRecord | null {
	if (!isObj(v)) return null;
	if (!isId(v.id) || !isStr(v.name) || !isNum(v.createdAt)) return null;
	if (!isStr(v.orderMode) || !ORDERS.includes(v.orderMode)) return null;
	return v as WorkRecord;
}

function endedWork(v: unknown): EndedWork | null {
	if (!isObj(v) || !workRecord(v.work) || !Array.isArray(v.members)) return null;
	if (!v.members.every((m) => isObj(m) && isId(m.seriesId) && isNum(m.position))) return null;
	return v as EndedWork;
}

/**
 * A TAKE OUT's facts, when they are this series' own: it is the series taken
 * out, and a Work the take-out ended had it among its members.
 */
export function takeOutFacts(v: unknown, seriesId: number): TakeOutFacts | null {
	if (!isObj(v) || v.seriesId !== seriesId) return null;
	if (!isId(v.workId) || !isNum(v.workCreatedAt) || !optStr(v.workName)) return null;
	if (!isStr(v.title) || !isNum(v.position)) return null;
	if (v.ended !== null) {
		const ended = endedWork(v.ended);
		if (!ended || !ended.members.some((m) => m.seriesId === seriesId)) return null;
	}
	return v as TakeOutFacts;
}

/**
 * An ADD TO A WORK's facts, when it is this series that was added: the Work
 * it came from (`former`) and any Work the add ended had it as a member.
 */
export function addFacts(v: unknown, seriesId: number): AddFacts | null {
	if (!isObj(v) || v.seriesId !== seriesId) return null;
	if (!isId(v.workId) || !isNum(v.workCreatedAt) || !optStr(v.workName)) return null;
	if (!isStr(v.title) || !isNum(v.position)) return null;
	const f = v.former;
	if (f !== null) {
		if (!isObj(f) || !isId(f.workId) || !isNum(f.createdAt) || !optStr(f.name)) return null;
		if (!isNum(f.position)) return null;
	}
	if (!Array.isArray(v.ended)) return null;
	for (const e of v.ended) {
		const ended = endedWork(e);
		if (!ended || !ended.members.some((m) => m.seriesId === seriesId)) return null;
	}
	return v as AddFacts;
}

/** A RENAME's facts, when it is this series that was renamed. */
export function renameFacts(v: unknown, seriesId: number): SeriesRenameFacts | null {
	if (!isObj(v) || v.seriesId !== seriesId) return null;
	if (!isStr(v.title) || !isStr(v.altTitles) || !isStr(v.name)) return null;
	return v as SeriesRenameFacts;
}

/**
 * A HIDE's facts from this screen (`hideWork`'s HIDE ALL n, or `hidePart`'s
 * TAKE OUT and hide), when they are this series' own: it is among what the
 * HIDE hid or took out, and every take-out is this series'. A part already
 * hidden before the press is taken out but not hidden by it, so `hidden` may
 * be empty while `out` names this series. The other ids HIDE ALL n hid are
 * the Work's parts then; they are not checked against the Work now, because
 * a Work ended since by another press is still undone part by part
 * (`undoHideWhole` shows a series in no Work).
 */
export function hideFacts(
	v: unknown,
	seriesId: number
): { hidden: number[]; out: TakeOutFacts[] } | null {
	if (!isObj(v) || !Array.isArray(v.hidden) || !Array.isArray(v.out)) return null;
	if (!v.hidden.every(isId)) return null;
	const hidden = v.hidden as number[];
	const out = v.out.map((o) => takeOutFacts(o, seriesId));
	if (out.some((o) => o === null)) return null;
	if (!hidden.includes(seriesId) && out.length === 0) return null;
	return { hidden, out: out as TakeOutFacts[] };
}
