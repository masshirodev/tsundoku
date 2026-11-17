import type { RequestHandler } from './$types';
import { isRevealed } from '$lib/server/prefs';
import { listHighlights } from '$lib/server/highlights';
import {
	filterHighlights,
	HIGHLIGHT_KINDS,
	slug,
	toMarkdown,
	type HighlightKind
} from '$lib/library/highlights';

/**
 * EXPORT: what the highlights page's filters show, as
 * Markdown. With `series=` it is that book, one heading per chapter in
 * reading order, saved as `<series>.md`; without, every series the filters
 * leave, grouped by series. `colours=tag` puts a quote's colour under it as a
 * tag; anything else leaves colours out. The same text COPY ALL copies, from
 * the same pure function (src/lib/library/highlights.ts). Hidden means hidden.
 */
export const GET: RequestHandler = async ({ url, cookies }) => {
	const p = url.searchParams;
	const kind = (HIGHLIGHT_KINDS as readonly string[]).includes(p.get('kind') ?? '')
		? (p.get('kind') as HighlightKind)
		: null;
	const series = Number(p.get('series')) || null;
	const list = filterHighlights(listHighlights(isRevealed(cookies)), {
		kind,
		series,
		lost: p.get('lost') === '1',
		q: (p.get('q') ?? '').trim()
	});
	const title = series !== null ? (list[0]?.seriesTitle ?? 'Highlights') : 'Highlights';
	const text = toMarkdown(list, title, {
		colours: p.get('colours') === 'tag' ? 'tag' : 'leave',
		now: Date.now(),
		bySeries: series === null
	});
	return new Response(text, {
		headers: {
			'content-type': 'text/markdown; charset=utf-8',
			'content-disposition': `attachment; filename="${series !== null ? slug(title) : 'highlights'}.md"`,
			'cache-control': 'no-store'
		}
	});
};
