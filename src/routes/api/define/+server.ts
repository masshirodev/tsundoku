import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { define, dictionaryAvailable } from '$lib/server/japanese/dict';
import * as english from '$lib/server/languages/en';

/**
 * A tapped word's dictionary entries (doc/LANGUAGES.md): the pack answers, the
 * panel draws.
 *
 * `?pack=` names the pack and defaults to `ja`, so an older reader keeps the
 * Japanese answer it has always had. Japanese takes `?lemma=&surface=&reading=`
 * as its tokenizer gives them, up to three entries, common ones first;
 * English takes `?surface=&after=`, where `after` is the text following the
 * tap, and looks up to two words into it so "give up" wins over "give"
 * (c198). `available: false` when that pack's dictionary has not been built.
 */
export const GET: RequestHandler = ({ url }) => {
	const headers = { 'cache-control': 'private, max-age=86400' };

	if (url.searchParams.get('pack') === 'en') {
		const surface = url.searchParams.get('surface') ?? '';
		const available = english.available();
		const entries = surface
			? english.define({ surface, after: url.searchParams.get('after') ?? '' })
			: [];
		return json({ entries, available }, { headers });
	}

	const lemma = url.searchParams.get('lemma') ?? '';
	if (!lemma) return json({ entries: [], available: dictionaryAvailable() });
	const entries = define({
		lemma,
		surface: url.searchParams.get('surface') ?? undefined,
		reading: url.searchParams.get('reading') ?? undefined
	});
	return json({ entries, available: dictionaryAvailable() }, { headers });
};
