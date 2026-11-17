import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isRevealed } from '$lib/server/prefs';
import { applyPending, decide, undoDecision, type Decided, type Decision } from '$lib/server/dupes';

const DECISIONS: Decision[] = ['keep', 'both', 'group', 'fold', 'apart'];

/**
 * The review's decisions (doc/DUPLICATE-BOOKS.md): `{ pair, decision, keep }`
 * settles a pair (what was decided before is carried out first);
 * `{ undo: pair }` forgets the last one; `{ apply: true }` carries out what
 * waits, on leaving the review. Both carrying-out answers bring `refused`
 * (decisions the library's state could not carry, with the reason, dropped so
 * the pair comes back to the review undecided) and `failed` (decisions a bug
 * or the disk stopped, which stay waiting).
 */
export const POST: RequestHandler = async ({ request, cookies }) => {
	const b = (await request.json().catch(() => null)) as {
		pair?: string;
		decision?: Decision;
		keep?: number | null;
		undo?: string;
		apply?: boolean;
	} | null;
	if (b?.apply) {
		const { applied, refused, failed } = await applyPending();
		return json({ applied, refused, failed });
	}
	if (b?.undo) return json({ undone: undoDecision(b.undo) });
	if (!b?.pair || !b.decision || !DECISIONS.includes(b.decision)) error(400, 'pair and decision');
	let answer: Decided;
	try {
		answer = await decide(b.pair, b.decision, b.keep ?? null, isRevealed(cookies));
	} catch (e) {
		error(409, (e as Error).message);
	}
	return json({ ok: true, ...answer });
};
