import { m } from '$lib/paraglide/messages';

/**
 * What the library and `/search` both read from an answer of the selection's
 * bar (doc/LIBRARY.md, "Acting on a selection from the search"), so the two
 * pages say and do the same thing: the library reads it from `form`, and
 * `/search`, which SvelteKit does not apply the library's answers to, from the
 * sheet's or the bar's own `result.data`.
 */

/**
 * GROUP into a Work's answer: `?/work` answers `{ made }`, `?/addToWork`
 * `{ addedWork }` (`src/routes/+page.server.ts`). Only what the band reads is
 * typed; the rest rides back to `?/undoWork` as it came.
 */
export type WorkAnswer =
	| { made: { work: { name: string }; members: unknown[] } }
	| { addedWork: { workId: number; name: string; facts: unknown[] } };

/** The GROUP answer in an action's data, or null when it is another action's. */
export function workAnswer(data: Record<string, unknown> | null | undefined): WorkAnswer | null {
	if (!data) return null;
	if ('made' in data && data.made)
		return { made: data.made as Extract<WorkAnswer, { made: unknown }>['made'] };
	if ('addedWork' in data && data.addedWork)
		return {
			addedWork: data.addedWork as Extract<WorkAnswer, { addedWork: unknown }>['addedWork']
		};
	return null;
}

/**
 * The band after GROUP into a Work, in the library's words, and what its UNDO
 * posts to `?/undoWork`: `kind` and the facts the create or the add answered.
 */
export function workBand(a: WorkAnswer): {
	title: string;
	detail: string;
	kind: 'create' | 'add';
	facts: string;
} {
	if ('made' in a)
		return {
			title: m.offer_work_made({ name: a.made.work.name.toUpperCase() }),
			detail: `${a.made.members.length} SERIES · EACH KEEPS ITS OWN`,
			kind: 'create',
			facts: JSON.stringify(a.made)
		};
	return {
		title: m.offer_added_to({ name: a.addedWork.name.toUpperCase() }),
		detail: `${a.addedWork.facts.length} SERIES · AT THE END OF THE RUN`,
		kind: 'add',
		facts: JSON.stringify(a.addedWork.facts)
	};
}

/**
 * Whether the bar's submit was a plain HIDE or UNHIDE (its `name="do"`
 * cells), whose success ends SELECT on both pages. FAV and a rating are the
 * same field with another value and leave SELECT on.
 */
export function plainHideOrUnhide(submitter: HTMLElement | null | undefined): boolean {
	return (
		submitter instanceof HTMLButtonElement &&
		submitter.name === 'do' &&
		(submitter.value === 'hide' || submitter.value === 'unhide')
	);
}
