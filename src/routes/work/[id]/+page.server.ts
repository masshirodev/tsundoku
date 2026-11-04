import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { isRevealed } from '$lib/server/prefs';
import { parseRating } from '$lib/library/rating';
import { continuePart } from '$lib/library/works';
import { resumeEntry } from '$lib/server/library';
import {
	WorkError,
	addSeries,
	rename,
	reorder,
	setWorkFavourite,
	setWorkRating,
	takeOut,
	ungroup,
	undoAdd,
	undoRename,
	undoTakeOuts,
	workPage,
	type AddFacts,
	type RenameFacts,
	type TakeOutFacts
} from '$lib/server/works';

/**
 * A Work's own screen (Work-Screen; doc/WORKS.md, question 2). `workPage` is
 * null for a Work that does not exist and for one hidden whole while reveal is
 * off: both are the same 404, because a hidden Work must not be findable by
 * trying ids.
 */
export const load: PageServerLoad = async ({ params, cookies }) => {
	const reveal = isRevealed(cookies);
	const id = Number(params.id);
	const page = Number.isInteger(id) && id > 0 ? workPage(id, { reveal }) : null;
	if (!page) error(404, 'not found');
	const current = continuePart(page.parts);
	const first = page.parts[0];
	return {
		...page,
		reveal,
		// CONTINUE across the Work: the part CONTINUE opens and where ▶ resumes in
		// it; once the run is read, part 1 is the way back in (Work-Screen).
		resume: current ? resumeEntry(current.seriesId) : null,
		again: first ? resumeEntry(first.seriesId) : null
	};
};

const idOf = (params: { id: string }) => Number(params.id);

/** A refusal the screen can say: W1's actions throw, and the band reads the reason. */
function refused(e: unknown) {
	if (e instanceof WorkError) return fail(400, { message: e.message.toUpperCase() });
	throw e;
}

export const actions: Actions = {
	/** ORDER's DONE: the whole list, in the order the rows were dragged into. */
	reorder: async ({ request, params }) => {
		const form = await request.formData();
		try {
			reorder(idOf(params), form.getAll('part').map(Number).filter(Number.isInteger));
		} catch (e) {
			return refused(e);
		}
		return { ok: true };
	},

	/**
	 * SELECT → TAKE OUT. Fewer than two parts left ends the Work, and a screen
	 * that no longer exists cannot show its own band: that case goes back to the
	 * library with the facts UNDO needs (doc/NAVIGATION.md, "Screens that are
	 * gone").
	 */
	takeOut: async ({ request, params }) => {
		const form = await request.formData();
		const facts = [];
		for (const seriesId of form.getAll('part').map(Number)) {
			try {
				const one = takeOut(idOf(params), seriesId);
				facts.push(one);
				if (one.ended) break;
			} catch (e) {
				if (facts.length === 0) return refused(e);
				break;
			}
		}
		const ended = facts.find((f) => f.ended)?.ended ?? null;
		if (ended) {
			const gone = new URLSearchParams({
				band: 'ended',
				name: ended.work.name,
				facts: JSON.stringify(facts)
			});
			redirect(303, `/?${gone}`);
		}
		return { out: facts };
	},

	undoTakeOut: async ({ request }) => {
		const form = await request.formData();
		const facts = JSON.parse(String(form.get('facts') ?? '[]')) as TakeOutFacts[];
		// Last first, as one write (`undoTakeOuts`): the second take-out is the
		// one that ended the Work, and it restores every member the ending left
		// behind. A series the library has moved on with since -- added to
		// another Work, say -- refuses the whole UNDO, and the band says why
		// (c308).
		try {
			undoTakeOuts(facts);
		} catch (e) {
			return refused(e);
		}
		return { ok: true };
	},

	/** + ADD A SERIES: a series from the library, or one moving in from another Work. */
	add: async ({ request, params }) => {
		const form = await request.formData();
		try {
			const facts = addSeries(idOf(params), Number(form.get('series')));
			return { added: facts };
		} catch (e) {
			return refused(e);
		}
	},

	undoAdd: async ({ request }) => {
		const form = await request.formData();
		const facts = JSON.parse(String(form.get('facts'))) as AddFacts;
		try {
			undoAdd(facts);
		} catch (e) {
			return refused(e);
		}
		return { ok: true };
	},

	rename: async ({ request, params }) => {
		const form = await request.formData();
		try {
			const name = String(form.get('name') ?? '').trim();
			if (name === '') return fail(400, { message: 'A WORK NEEDS A NAME' });
			return { renamed: rename(idOf(params), name) };
		} catch (e) {
			return refused(e);
		}
	},

	undoRename: async ({ request }) => {
		const form = await request.formData();
		const facts = JSON.parse(String(form.get('facts'))) as RenameFacts;
		undoRename(facts);
		return { ok: true };
	},

	/**
	 * UNGROUP takes every series out and ends the Work, so the screen goes too:
	 * the library shows the band and UNDO restores the same id, name and order.
	 */
	ungroup: async ({ params }) => {
		let facts;
		try {
			facts = ungroup(idOf(params));
		} catch (e) {
			return refused(e);
		}
		const gone = new URLSearchParams({
			band: 'ungrouped',
			name: facts.work.name,
			facts: JSON.stringify(facts)
		});
		redirect(303, `/?${gone}`);
	},

	/**
	 * RATING and FAV are the parts', set together only while they agree
	 * (doc/WORKS.md, "A Work's rating and FAV"). The server's own setters check
	 * the agreement again over every membership, so a partial page cannot write
	 * what it could not see.
	 */
	rate: async ({ request, params }) => {
		const form = await request.formData();
		const rating = parseRating(form.get('rating'));
		if (rating === undefined) return fail(400, { message: 'RATING MUST BE 0-10' });
		try {
			setWorkRating(idOf(params), rating);
		} catch (e) {
			return refused(e);
		}
		return { ok: true };
	},

	favourite: async ({ request, params }) => {
		const form = await request.formData();
		try {
			setWorkFavourite(idOf(params), form.get('on') === '1');
		} catch (e) {
			return refused(e);
		}
		return { ok: true };
	}
};
