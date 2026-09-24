import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { define, dictionaryAvailable } from '$lib/server/japanese/dict';

/**
 * A word's dictionary entries (doc/JAPANESE.md): `?lemma=&surface=&reading=`,
 * as the tokenizer gives them. Up to three entries, common ones first.
 * `available: false` when JMdict hasn't been built.
 */
export const GET: RequestHandler = ({ url }) => {
	const lemma = url.searchParams.get('lemma') ?? '';
	if (!lemma) return json({ entries: [], available: dictionaryAvailable() });
	const entries = define({
		lemma,
		surface: url.searchParams.get('surface') ?? undefined,
		reading: url.searchParams.get('reading') ?? undefined
	});
	return json(
		{ entries, available: dictionaryAvailable() },
		{ headers: { 'cache-control': 'private, max-age=86400' } }
	);
};
