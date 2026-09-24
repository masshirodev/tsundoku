import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { isRevealed } from '$lib/server/prefs';
import { getSetting, setSetting } from '$lib/server/settings';
import { VISIBLE_SQL } from '$lib/server/visibility';
import { refreshCovers } from '$lib/server/covers';
import { PREFERRED } from '$lib/library/editions';

/**
 * SETTINGS (Editions 1e; doc/SETTINGS.md): the library's own preferences, as
 * opposed to a device's. One so far: the language a folded book opens in.
 * Counts follow reveal, as every list does: hidden books aren't counted.
 */
export const load: PageServerLoad = async ({ cookies }) => {
	const reveal = isRevealed(cookies);
	const folded = getDb()
		.prepare(
			`SELECT s.id, s.edition_lang FROM series s JOIN roots r ON r.id = s.root_id
			WHERE (? OR ${VISIBLE_SQL})
			AND EXISTS (SELECT 1 FROM entries e WHERE e.series_id = s.id AND e.edition_of IS NOT NULL)`
		)
		.all(reveal ? 1 : 0) as { id: number; edition_lang: string | null }[];
	return {
		preferred: getSetting('edition_language'),
		choices: [...PREFERRED],
		folded: folded.length,
		overridden: folded.filter((f) => f.edition_lang !== null).length
	};
};

export const actions: Actions = {
	language: async ({ request }) => {
		const l = String((await request.formData()).get('language') ?? '');
		if (!(PREFERRED as readonly string[]).includes(l))
			return fail(400, { message: 'no such language' });
		setSetting('edition_language', l);
		// Folded books wear their opening edition's cover: which one may have changed.
		const ids = (
			getDb()
				.prepare(`SELECT DISTINCT series_id AS id FROM entries WHERE edition_of IS NOT NULL`)
				.all() as { id: number }[]
		).map((r) => r.id);
		if (ids.length) void refreshCovers({ ids, remote: false });
		return { ok: true };
	}
};
