import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { isRevealed } from '$lib/server/prefs';
import { getSetting, setSetting } from '$lib/server/settings';
import { VISIBLE_SQL } from '$lib/server/visibility';
import { refreshCovers } from '$lib/server/covers';
import { PREFERRED } from '$lib/library/editions';
import { linkCount, linkQueueCount } from '$lib/server/catalogue';
import { accounts, retry, signOut } from '$lib/server/tracking';
import { ranobeAccount, ranobeQueueCount, retryRanobe } from '$lib/server/ranobe-review';
import { SERVICES, type Service } from '$lib/library/tracking';
import { downloadsBackend } from '$lib/server/engine/run';
import { browseLanguages } from '$lib/server/engine/browse';
import { listings } from '$lib/server/engine/extensions';

/** The languages the repositories list, most extensions first: the BROWSE row's cells. */
function listedLanguages(): string[] {
	const n = new Map<string, number>();
	for (const l of listings())
		for (const lang of new Set(l.sources.map((s) => s.lang.toLowerCase())))
			if (lang && lang !== 'all' && lang !== 'multi') n.set(lang, (n.get(lang) ?? 0) + 1);
	return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l);
}

const DEFAULT_LANGUAGES = ['en', 'ja'];

/** The cells shown: what's chosen, then the commonest others, twelve at most. */
const LANGUAGE_CELLS = 12;

/**
 * SETTINGS (Editions 1e; doc/SETTINGS.md): the library's own preferences, as
 * opposed to a device's: the language a folded book opens in, the
 * catalogues, and the languages BROWSE lists sources in.
 * Counts follow reveal, as every list does: hidden books aren't counted.
 */
export const load: PageServerLoad = async ({ cookies, url }) => {
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
		overridden: folded.filter((f) => f.edition_lang !== null).length,
		// CATALOGUES (Catalogue Links 1u, 1v; doc/TRACKING.md).
		catalogues: {
			linked: linkCount(),
			toReview: linkQueueCount(reveal) + ranobeQueueCount(),
			accounts: accounts(),
			// The third row (Ranobe 3a–3c; doc/RANOBE.md): no sign-in, a token in .env.
			ranobe: ranobeAccount()
		},
		// How a sign-in went, coming back from the catalogue.
		signin: url.searchParams.has('signin')
			? {
					outcome: url.searchParams.get('signin') ?? '',
					service: url.searchParams.get('service') ?? ''
				}
			: null,
		// BROWSE (doc/BROWSE.md): the languages it lists sources in, and opens AVAILABLE filtered to.
		browse:
			downloadsBackend() === 'engine'
				? (() => {
						const chosen = browseLanguages();
						// The defaults always have a cell, so one turned off can come back
						// even when no repository lists it.
						const rest = [...DEFAULT_LANGUAGES, ...listedLanguages()].filter(
							(l, i, all) => !chosen.includes(l) && all.indexOf(l) === i
						);
						return {
							chosen,
							cells: [...chosen, ...rest].slice(0, Math.max(LANGUAGE_CELLS, chosen.length)),
							animeQuality: getSetting('anime_download_quality')
						};
					})()
				: null
	};
};

const serviceOf = async (request: Request): Promise<Service | null> => {
	const s = String((await request.formData()).get('service') ?? '') as Service;
	return SERVICES.includes(s) ? s : null;
};

export const actions: Actions = {
	signOut: async ({ request }) => {
		const s = await serviceOf(request);
		if (!s) return fail(400, { message: 'which catalogue' });
		signOut(s);
		return { ok: true };
	},
	retry: async ({ request }) => {
		const s = await serviceOf(request);
		if (!s) return fail(400, { message: 'which catalogue' });
		return { retried: await retry(s) };
	},
	retryRanobe: async () => {
		await retryRanobe();
		return { ok: true };
	},
	/** A language in or out of BROWSE's; at least one stays, or nothing would be listed. */
	browseLanguage: async ({ request }) => {
		const l = String((await request.formData()).get('lang') ?? '').toLowerCase();
		if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(l)) return fail(400, { message: 'no such language' });
		const now = browseLanguages();
		const next = now.includes(l) ? now.filter((x) => x !== l) : [...now, l];
		if (next.length === 0) return fail(400, { message: 'BROWSE needs one language' });
		setSetting('browse_languages', next.join(','));
		return { ok: true };
	},
	/** The height episodes download at (doc/ANIME.md, "Downloading"). */
	animeQuality: async ({ request }) => {
		const q = String((await request.formData()).get('quality') ?? '');
		if (!['1080', '720', '360'].includes(q)) return fail(400, { message: 'no such quality' });
		setSetting('anime_download_quality', q);
		return { ok: true };
	},
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
