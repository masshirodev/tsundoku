/**
 * ComicInfo.xml as Mihon writes it into every downloaded CBZ. It is a flat
 * list of elements, so this reads elements by local name (Mihon's own ones
 * are namespaced: `ty:PublishingStatusTachiyomi`, `mh:SourceMihon`) rather
 * than bringing in an XML parser. Writer and Penciller are `_` when unknown;
 * that reads as empty.
 */
export type ComicInfo = {
	title: string;
	series: string;
	/** NaN when absent or not a number. */
	number: number;
	summary: string;
	writer: string;
	penciller: string;
	genres: string[];
	/** Every URL in `Web`: Mihon puts the tracker's and the chapter's there. */
	web: string[];
	status: string;
	categories: string[];
	source: string;
};

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function unescape(s: string): string {
	return s
		.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
		.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, e: string) => {
			if (e[0] === '#') {
				const code =
					e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
				return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
			}
			return ENTITIES[e.toLowerCase()] ?? whole;
		})
		.trim();
}

function element(xml: string, name: string): string {
	const re = new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`);
	const m = re.exec(xml);
	const v = m ? unescape(m[1]) : '';
	return v === '_' ? '' : v;
}

const list = (s: string) =>
	s
		.split(',')
		.map((x) => x.trim())
		.filter((x) => x !== '');

export function parseComicInfo(xml: string): ComicInfo {
	const number = element(xml, 'Number');
	return {
		title: element(xml, 'Title'),
		series: element(xml, 'Series'),
		number: number === '' ? NaN : Number(number),
		summary: element(xml, 'Summary'),
		writer: element(xml, 'Writer'),
		penciller: element(xml, 'Penciller'),
		genres: list(element(xml, 'Genre')),
		web: element(xml, 'Web')
			.split(/\s+/)
			.filter((u) => /^https?:\/\//.test(u)),
		status: element(xml, 'PublishingStatusTachiyomi'),
		categories: list(element(xml, 'Categories')),
		source: element(xml, 'SourceMihon')
	};
}
