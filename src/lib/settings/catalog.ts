/**
 * Every setting, once (doc/SETTINGS.md; card c171, Settings.dc.html): where
 * it's kept, what it starts as, and how the SETTINGS page draws it. Pure, so
 * the page, the readers and the server agree on one list.
 *
 * Three places a value is kept, as the page's legend says them:
 *
 * - **library**: the workstation's `settings` table, one value everywhere
 *   (ALL DEVICES), or a default a series can differ from (DEFAULT · EVERY
 *   DEVICE).
 * - **device**: this browser's storage, mirrored on the workstation per
 *   device (the owner's answer to question 1), so the page can show and
 *   change another device's.
 * - **episode**: SPEED, which every episode starts at 1×; listed, not set.
 */

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export type ValueDef = {
	where: 'library' | 'device';
	/** library: the `settings` key; device: the browser's storage key. */
	key: string;
	/** A field of a stored object: the text reader keeps its settings as one. */
	field?: string;
	def: Json;
	/** How the value reads in a band ("125%", "ON"), when the options don't say. */
	label?: (v: Json) => string;
};

const pct = (v: Json) => `${Math.round(Number(v) * 100)}%`;
const onOff = (v: Json) => (v ? 'ON' : 'OFF');

/** Every value a row sets, by id. */
export const VALUES = {
	// 01 — reading, images (the READING sheet's, ImageReader.svelte)
	'mode.manga': { where: 'library', key: 'mode_manga', def: 'rtl' },
	'mode.manhwa': { where: 'library', key: 'mode_manhwa', def: 'vertical' },
	'mode.doujin': { where: 'library', key: 'mode_doujin', def: 'rtl' },
	'reader.fit': { where: 'device', key: 'tsundoku.reader.fit', def: 'screen' },
	'zoom.paged.phone': {
		where: 'device',
		key: 'tsundoku.reader.zoom.paged.phone',
		def: 1,
		label: pct
	},
	'zoom.paged.wide': {
		where: 'device',
		key: 'tsundoku.reader.zoom.paged.wide',
		def: 1,
		label: pct
	},
	'zoom.vertical.phone': {
		where: 'device',
		key: 'tsundoku.reader.zoom.vertical.phone',
		def: 1,
		label: pct
	},
	'zoom.vertical.wide': {
		where: 'device',
		key: 'tsundoku.reader.zoom.vertical.wide',
		def: 1,
		label: pct
	},
	'reader.spreads': { where: 'device', key: 'tsundoku.reader.spreads', def: false, label: onOff },
	'reader.crop': { where: 'device', key: 'tsundoku.reader.crop', def: false, label: onOff },
	'reader.wide': { where: 'device', key: 'tsundoku.reader.wide', def: 'fit' },
	'reader.sides': { where: 'device', key: 'tsundoku.reader.sides', def: 0 },
	'reader.blocks': { where: 'device', key: 'tsundoku.reader.blocks', def: 'controls' },
	// Shared by both readers: it's about the room, not the book.
	'reader.dim': { where: 'device', key: 'tsundoku.reader.dim', def: 0, label: pct },
	// 02 — reading, novels (TextSheet.svelte; one stored object)
	'layout.novel': { where: 'library', key: 'mode_novel', def: 'paged' },
	'text.theme': { where: 'device', key: 'tsundoku.text.settings', field: 'theme', def: 'dark' },
	'text.font': { where: 'device', key: 'tsundoku.text.settings', field: 'font', def: 'serif' },
	'text.size': {
		where: 'device',
		key: 'tsundoku.text.settings',
		field: 'size',
		def: null,
		label: (v) => (v === null ? "THE DEVICE'S" : `${v} PX`)
	},
	'text.margins': {
		where: 'device',
		key: 'tsundoku.text.settings',
		field: 'margins',
		def: 'normal'
	},
	'text.columns': {
		where: 'device',
		key: 'tsundoku.text.settings',
		field: 'columns',
		def: true,
		label: onOff
	},
	'text.justify': {
		where: 'device',
		key: 'tsundoku.text.settings',
		field: 'justify',
		def: true,
		label: onOff
	},
	'text.furigana': {
		where: 'device',
		key: 'tsundoku.text.settings',
		field: 'furigana',
		def: 'all'
	},
	// 03 — watching (VideoPlayer.svelte). '' is FOLLOW THE PLAYER, the "none set" state.
	'anime.audio': { where: 'library', key: 'anime_audio_default', def: '' },
	'anime.subs': { where: 'library', key: 'anime_subs_default', def: '' },
	'anime.subsize': { where: 'library', key: 'anime_subsize_default', def: '' },
	// Null: the highest the server offers.
	'anime.quality': { where: 'device', key: 'tsundoku:anime:quality', def: null },
	'anime.dim': { where: 'device', key: 'tsundoku:anime:dim', def: 0, label: pct },
	// 04 — downloading
	'dl.quality': { where: 'library', key: 'anime_download_quality', def: '1080' },
	// The languages kept beside the original; '' keeps every one (c160).
	'dl.audio': {
		where: 'library',
		key: 'anime_download_audio',
		def: '',
		label: (v) => (!v ? 'ALL' : v === 'ORIGINAL' ? 'THE ORIGINAL' : String(v))
	},
	'dl.subs': { where: 'library', key: 'anime_download_subs', def: 'all' },
	// 05 — library
	'edition.language': { where: 'library', key: 'edition_language', def: 'english' },
	// 08 — devices: the theme cookie, mirrored like any device value.
	theme: { where: 'device', key: 'tsundoku.theme', def: 'dark' }
} as const satisfies Record<string, ValueDef>;

export type ValueId = keyof typeof VALUES;

export const valueDef = (id: ValueId): ValueDef => VALUES[id];

/** The library's keys the page may write: anything else is refused. */
export const LIBRARY_KEYS = Object.values(VALUES as Record<string, ValueDef>)
	.filter((v) => v.where === 'library')
	.map((v) => v.key);

/** Every key a device keeps, as its storage names it: what the device record mirrors. */
export const DEVICE_KEYS = [
	...new Set(
		Object.values(VALUES as Record<string, ValueDef>)
			.filter((v) => v.where === 'device')
			.map((v) => v.key)
	)
];

export const equal = (a: Json, b: Json) => JSON.stringify(a) === JSON.stringify(b);

/** Off its default: what earns the accent rule and RESET. Unset is the default. */
export const isChanged = (id: ValueId, v: Json | undefined) =>
	v !== undefined && !equal(v, valueDef(id).def);

// ---- the rows ---------------------------------------------------------------------------

export type Opt = { value: Json; label: string; short?: string };

export type Control =
	/** Segments; several groups on one row (MODE's three kinds, SUBTITLES' track and size). */
	| { type: 'seg'; groups: { k?: string; value: ValueId; opts: Opt[] }[] }
	/** Several of a set (AUDIO KEPT, BROWSE's LANGUAGES). */
	| { type: 'chips'; value: ValueId | 'browse.languages' }
	/** − value + for each kept zoom. */
	| { type: 'zoom'; cells: { h: string; value: ValueId }[] }
	/** A − / + stepper with the value between (novel SIZE). */
	| { type: 'step'; value: ValueId }
	/** Shown, set elsewhere: DIM, SPEED. */
	| { type: 'info'; value: ValueId | 'speed' }
	/** A catalogue's sign-in, a device: the page's own rows, drawn from the server's data. */
	| { type: 'account'; id: string };

export type Where = 'all' | 'device' | 'default' | 'episode';

export type RowDef = {
	id: string;
	label: string;
	where: Where;
	control: Control;
	meta?: string;
	/** What RESET goes back to, when RESET alone doesn't say it. */
	reset?: string;
	/** A default a series can differ from: whose overrides are counted (N SERIES DIFFER →). */
	overrides?: 'mode' | 'audio' | 'subs' | 'edition';
};

export type SectionId =
	| 'images'
	| 'novels'
	| 'watching'
	| 'downloading'
	| 'library'
	| 'catalogues'
	| 'browse'
	| 'devices';

export type SectionDef = {
	id: SectionId;
	n: string;
	title: string;
	/** The phone's shorter name (READING · IMAGES). */
	short?: string;
	/** What `/settings <word>` lands on. */
	words: string[];
	rows: RowDef[];
};

const MODES: Opt[] = [
	{ value: 'rtl', label: 'R→L' },
	{ value: 'ltr', label: 'L→R' },
	{ value: 'vertical', label: 'VERT.' }
];
const OFF_ON: Opt[] = [
	{ value: false, label: 'OFF' },
	{ value: true, label: 'ON' }
];

/** The languages a track can be, as the player names them. */
export const TRACK_LANGS = ['JA', 'EN', 'ES', 'PT', 'FR', 'DE', 'IT', 'AR', 'KO', 'ZH'] as const;

/** AUDIO KEPT's value for the original alone: '' already means every track. */
export const ORIGINAL_ONLY = 'ORIGINAL';

/**
 * AUDIO KEPT's value read: null keeps every track (''), [] the original
 * alone (ORIGINAL), else the languages kept beside it.
 */
export function keptOf(v: string): string[] | null {
	if (!v) return null;
	if (v.toUpperCase() === ORIGINAL_ONLY) return [];
	return parseKept(v);
}

/** AUDIO KEPT's languages, comma-separated: the known ones only. */
export function parseKept(v: string): string[] {
	return v
		.split(',')
		.map((l) => l.trim().toUpperCase())
		.filter((l) => (TRACK_LANGS as readonly string[]).includes(l));
}

export const SECTIONS: SectionDef[] = [
	{
		id: 'images',
		n: '01',
		title: 'READING · MANGA AND MANHWA',
		short: 'READING · IMAGES',
		words: ['reading', 'images', 'manga', 'manhwa', 'reader'],
		rows: [
			{
				id: 'mode',
				label: 'MODE',
				where: 'default',
				overrides: 'mode',
				control: {
					type: 'seg',
					groups: [
						{ k: 'MANGA', value: 'mode.manga', opts: MODES },
						{ k: 'MANHWA', value: 'mode.manhwa', opts: MODES },
						{ k: 'DOUJIN', value: 'mode.doujin', opts: MODES }
					]
				},
				meta: 'WHERE A SERIES OF THE KIND STARTS · REMEMBER IN THE READER MAKES A SERIES DIFFER'
			},
			{
				id: 'fit',
				label: 'FIT',
				where: 'device',
				control: {
					type: 'seg',
					groups: [
						{
							value: 'reader.fit',
							opts: [
								{ value: 'width', label: 'WIDTH' },
								{ value: 'height', label: 'HEIGHT' },
								{ value: 'screen', label: 'SCREEN' }
							]
						}
					]
				},
				meta: 'PAGED ONLY · VERTICAL FITS WIDTH'
			},
			{
				id: 'zoom',
				label: 'ZOOM',
				where: 'device',
				control: {
					type: 'zoom',
					cells: [
						{ h: 'PAGED · PHONE', value: 'zoom.paged.phone' },
						{ h: 'PAGED · WIDER', value: 'zoom.paged.wide' },
						{ h: 'VERTICAL · PHONE', value: 'zoom.vertical.phone' },
						{ h: 'VERTICAL · WIDER', value: 'zoom.vertical.wide' }
					]
				},
				meta: 'WHERE EVERY SERIES IN THE MODE STARTS · PHONE IS UNDER 600PX, SO A NARROW WINDOW USES IT',
				reset: 'RESET TO 100%'
			},
			{
				id: 'spreads',
				label: 'SPREADS',
				where: 'device',
				control: { type: 'seg', groups: [{ value: 'reader.spreads', opts: OFF_ON }] },
				meta: 'LANDSCAPE · PAGED'
			},
			{
				id: 'crop',
				label: 'CROP BORDERS',
				where: 'device',
				control: { type: 'seg', groups: [{ value: 'reader.crop', opts: OFF_ON }] },
				meta: 'WHITE OR BLACK MARGINS · PAGED ONLY'
			},
			{
				id: 'wide',
				label: 'WIDE PAGES',
				where: 'device',
				control: {
					type: 'seg',
					groups: [
						{
							value: 'reader.wide',
							opts: [
								{ value: 'fit', label: 'WHOLE' },
								{ value: 'split', label: 'SPLIT' },
								{ value: 'rotate', label: 'ROTATE' }
							]
						}
					]
				}
			},
			{
				id: 'sides',
				label: 'SIDES',
				where: 'device',
				control: {
					type: 'seg',
					groups: [
						{
							value: 'reader.sides',
							opts: [
								{ value: 0, label: 'NONE' },
								{ value: 10, label: '10%' },
								{ value: 20, label: '20%' },
								{ value: 30, label: '30%' }
							]
						}
					]
				},
				meta: 'VERTICAL ONLY'
			},
			{
				id: 'blocks',
				label: 'BLOCKS',
				where: 'device',
				control: {
					type: 'seg',
					groups: [
						{
							value: 'reader.blocks',
							opts: [
								{ value: 'controls', label: 'WITH CONTROLS', short: 'CONTROLS' },
								{ value: 'always', label: 'ALWAYS' },
								{ value: 'never', label: 'NEVER' }
							]
						}
					]
				},
				meta: "OUTLINES OCR'D TEXT IN RAW JAPANESE"
			},
			{
				id: 'dim',
				label: 'DIM',
				where: 'device',
				control: { type: 'info', value: 'reader.dim' },
				meta: 'SET IN THE READER, WHERE YOU CAN SEE THE PAGE'
			}
		]
	},
	{
		id: 'novels',
		n: '02',
		title: 'READING · NOVELS',
		words: ['novels', 'novel', 'text', 'books'],
		rows: [
			{
				id: 'layout',
				label: 'LAYOUT',
				where: 'default',
				overrides: 'mode',
				control: {
					type: 'seg',
					groups: [
						{
							value: 'layout.novel',
							opts: [
								{ value: 'paged', label: 'PAGED' },
								{ value: 'scroll', label: 'SCROLL' }
							]
						}
					]
				},
				meta: 'WHERE A NOVEL STARTS · REMEMBER IN THE READER MAKES ONE DIFFER'
			},
			{
				id: 'page',
				label: 'PAGE',
				where: 'device',
				control: {
					type: 'seg',
					groups: [
						{
							value: 'text.theme',
							opts: [
								{ value: 'dark', label: 'DARK' },
								{ value: 'paper', label: 'PAPER' }
							]
						}
					]
				}
			},
			{
				id: 'typeface',
				label: 'TYPEFACE',
				where: 'device',
				control: {
					type: 'seg',
					groups: [
						{
							value: 'text.font',
							opts: [
								{ value: 'serif', label: 'PLEX SERIF' },
								{ value: 'sans', label: 'PLEX SANS' }
							]
						}
					]
				}
			},
			{
				id: 'size',
				label: 'SIZE',
				where: 'device',
				control: { type: 'step', value: 'text.size' },
				meta: "THE DEVICE'S OWN UNTIL CHANGED",
				reset: "RESET · DEVICE'S"
			},
			{
				id: 'margins',
				label: 'MARGINS',
				where: 'device',
				control: {
					type: 'seg',
					groups: [
						{
							value: 'text.margins',
							opts: [
								{ value: 'narrow', label: 'NARROW' },
								{ value: 'normal', label: 'NORMAL' },
								{ value: 'wide', label: 'WIDE' }
							]
						}
					]
				}
			},
			{
				id: 'columns',
				label: 'COLUMNS',
				where: 'device',
				control: { type: 'seg', groups: [{ value: 'text.columns', opts: OFF_ON }] },
				meta: 'LANDSCAPE · PAGED'
			},
			{
				id: 'justify',
				label: 'JUSTIFY',
				where: 'device',
				control: { type: 'seg', groups: [{ value: 'text.justify', opts: OFF_ON }] },
				meta: 'HYPHENATES'
			},
			{
				id: 'furigana',
				label: 'FURIGANA',
				where: 'device',
				control: {
					type: 'seg',
					groups: [
						{
							value: 'text.furigana',
							opts: [
								{ value: 'all', label: 'ALL' },
								{ value: 'unknown', label: 'UNKNOWN' },
								{ value: 'none', label: 'NONE' }
							]
						}
					]
				},
				meta: 'JAPANESE BOOKS ONLY · UNKNOWN: OVER WORDS NOT YET LEARNED'
			}
		]
	},
	{
		id: 'watching',
		n: '03',
		title: 'WATCHING',
		words: ['watching', 'anime', 'player', 'video'],
		rows: [
			{
				id: 'audio',
				label: 'AUDIO',
				where: 'default',
				overrides: 'audio',
				control: {
					type: 'seg',
					groups: [
						{
							value: 'anime.audio',
							opts: [
								{ value: '', label: 'FOLLOW THE PLAYER', short: 'PLAYER' },
								{ value: 'JA', label: 'JA' },
								{ value: 'EN', label: 'EN' },
								{ value: 'ES', label: 'ES' }
							]
						}
					]
				},
				reset: 'RESET · FOLLOW'
			},
			{
				id: 'subtitles',
				label: 'SUBTITLES',
				where: 'default',
				overrides: 'subs',
				control: {
					type: 'seg',
					groups: [
						{
							k: 'TRACK',
							value: 'anime.subs',
							opts: [
								{ value: '', label: 'FOLLOW THE PLAYER', short: 'PLAYER' },
								{ value: 'off', label: 'OFF' },
								{ value: 'EN', label: 'EN' },
								{ value: 'JA', label: 'JA' }
							]
						},
						{
							k: 'SIZE',
							value: 'anime.subsize',
							opts: [
								{ value: 'S', label: 'S' },
								{ value: 'M', label: 'M' },
								{ value: 'L', label: 'L' }
							]
						}
					]
				},
				reset: 'RESET · FOLLOW'
			},
			{
				id: 'quality',
				label: 'QUALITY',
				where: 'device',
				control: {
					type: 'seg',
					groups: [
						{
							value: 'anime.quality',
							opts: [
								{ value: null, label: 'HIGHEST' },
								{ value: 1080, label: '1080P' },
								{ value: 720, label: '720P' },
								{ value: 360, label: '360P' }
							]
						}
					]
				},
				meta: "WHAT A STREAM STARTS AT · THE PLAYER'S SHEET CHANGES ONE EPISODE"
			},
			{
				id: 'speed',
				label: 'SPEED',
				where: 'episode',
				control: { type: 'info', value: 'speed' },
				meta: 'EVERY EPISODE STARTS AT 1× · CHANGED IN THE PLAYER ONLY'
			},
			{
				id: 'player-dim',
				label: 'DIM',
				where: 'device',
				control: { type: 'info', value: 'anime.dim' },
				meta: 'SET IN THE PLAYER'
			}
		]
	},
	{
		id: 'downloading',
		n: '04',
		title: 'DOWNLOADING',
		words: ['downloading', 'downloads', 'download'],
		rows: [
			{
				id: 'episodes-at',
				label: 'EPISODES AT',
				where: 'all',
				control: {
					type: 'seg',
					groups: [
						{
							value: 'dl.quality',
							opts: [
								{ value: '1080', label: '1080P' },
								{ value: '720', label: '720P' },
								{ value: '360', label: '360P' }
							]
						}
					]
				},
				meta: 'EVERY ALL ASKS AGAIN, WITH THE SIZE'
			},
			{
				id: 'audio-kept',
				label: 'AUDIO KEPT',
				where: 'all',
				control: { type: 'chips', value: 'dl.audio' },
				meta: 'A DOWNLOAD KEEPS THE ORIGINAL AND THESE · NEW DOWNLOADS ONLY',
				reset: 'RESET · ALL KEPT'
			},
			{
				id: 'subs-kept',
				label: 'SUBTITLES KEPT',
				where: 'all',
				control: {
					type: 'seg',
					groups: [
						{
							value: 'dl.subs',
							opts: [
								{ value: 'all', label: 'ALL' },
								{ value: 'audio', label: 'AS AUDIO' }
							]
						}
					]
				},
				meta: 'SUBTITLES ARE SMALL, SO ALL ARE KEPT'
			}
		]
	},
	{
		id: 'library',
		n: '05',
		title: 'LIBRARY',
		words: ['library', 'editions', 'languages'],
		rows: [
			{
				id: 'books-open-in',
				label: 'BOOKS OPEN IN',
				where: 'default',
				overrides: 'edition',
				control: {
					type: 'seg',
					groups: [
						{
							value: 'edition.language',
							opts: [
								{ value: 'english', label: 'ENGLISH', short: 'EN' },
								{ value: 'japanese', label: 'JAPANESE', short: 'JA' },
								{ value: 'chinese', label: 'CHINESE', short: 'ZH' },
								{ value: 'korean', label: 'KOREAN', short: 'KO' }
							]
						}
					]
				},
				meta: 'A FOLDED BOOK OPENS IN THIS LANGUAGE · WITHOUT IT, IN THE ONE LAST READ'
			}
		]
	},
	{
		id: 'catalogues',
		n: '06',
		title: 'CATALOGUES',
		words: ['catalogues', 'anilist', 'mal', 'ranobe', 'tracking'],
		rows: [
			{
				id: 'anilist',
				label: 'ANILIST',
				where: 'all',
				control: { type: 'account', id: 'anilist' }
			},
			{ id: 'mal', label: 'MAL', where: 'all', control: { type: 'account', id: 'mal' } },
			{ id: 'ranobe', label: 'RANOBE', where: 'all', control: { type: 'account', id: 'ranobe' } }
		]
	},
	{
		id: 'browse',
		n: '07',
		title: 'BROWSE',
		words: ['browse', 'sources'],
		rows: [
			{
				id: 'languages',
				label: 'LANGUAGES',
				where: 'all',
				control: { type: 'chips', value: 'browse.languages' },
				meta: 'BROWSE LISTS SOURCES IN THESE, AND ANY THE LIBRARY READS FROM'
			}
		]
	},
	{
		id: 'devices',
		n: '08',
		title: 'DEVICES',
		words: ['devices', 'device', 'theme', 'wifi', 'wi-fi', 'phone', 'pair'],
		rows: [
			{
				id: 'theme',
				label: 'THEME',
				where: 'device',
				control: {
					type: 'seg',
					groups: [
						{
							value: 'theme',
							opts: [
								{ value: 'dark', label: 'DARK' },
								{ value: 'light', label: 'LIGHT' }
							]
						}
					]
				},
				meta: 'ALSO /DARK AND /LIGHT IN SEARCH'
			}
		]
	}
];

/** `/settings watching`: the section a word names, else none (the top of the page). */
export function sectionFor(word: string): SectionId | null {
	const w = word.trim().toLowerCase();
	if (!w) return null;
	return (
		SECTIONS.find((s) => s.words.includes(w))?.id ??
		SECTIONS.find((s) => s.words.some((x) => x.startsWith(w)))?.id ??
		null
	);
}

/** The values a row sets. */
export function rowValues(row: RowDef): ValueId[] {
	const c = row.control;
	if (c.type === 'seg') return c.groups.map((g) => g.value);
	if (c.type === 'zoom') return c.cells.map((z) => z.value);
	if (c.type === 'step') return [c.value];
	if (c.type === 'chips' && c.value !== 'browse.languages') return [c.value];
	// DIM and SPEED are shown, not set here; the accounts and BROWSE's languages
	// have their own actions and no default to go back to.
	return [];
}

export type Values = Partial<Record<ValueId, Json>>;

export const rowChanged = (row: RowDef, values: Values) =>
	rowValues(row).some((id) => isChanged(id, values[id]));

export const sectionChanged = (s: SectionDef, values: Values) =>
	s.rows.filter((r) => rowChanged(r, values)).length;

/** How a value reads in RESET's band: its option's label, else the row's own way. */
export function valueLabel(id: ValueId, v: Json | undefined): string {
	const val = v === undefined ? valueDef(id).def : v;
	for (const s of SECTIONS)
		for (const r of s.rows)
			if (r.control.type === 'seg')
				for (const g of r.control.groups)
					if (g.value === id) {
						const o = g.opts.find((o) => equal(o.value, val));
						if (o) return o.label;
					}
	const def = valueDef(id);
	if (def.label) return def.label(val);
	if (Array.isArray(val)) return val.length ? val.join(', ') : 'ALL';
	return val === '' || val === null ? 'NONE' : String(val).toUpperCase();
}

export type Move = { id: ValueId; label: string; from: string; to: string };

/**
 * What RESET (a row's) or RESET SECTION moves back to the default, for the
 * band that says so: "ZOOM 125% → 100% · CROP BORDERS ON → OFF". UNDO puts
 * these values back.
 */
export function resetMoves(rows: RowDef[], values: Values): Move[] {
	const out: Move[] = [];
	for (const r of rows)
		for (const id of rowValues(r))
			if (isChanged(id, values[id]))
				out.push({
					id,
					label: rowValues(r).length > 1 && r.control.type === 'seg' ? groupLabel(r, id) : r.label,
					from: valueLabel(id, values[id]),
					to: valueLabel(id, undefined)
				});
	return out;
}

function groupLabel(r: RowDef, id: ValueId): string {
	const g = r.control.type === 'seg' ? r.control.groups.find((g) => g.value === id) : undefined;
	return g?.k ? `${r.label} ${g.k}` : r.label;
}

export const movesLine = (moves: Move[]) =>
	moves.map((m) => `${m.label} ${m.from} → ${m.to}`).join(' · ');

// ---- where it applies ----------------------------------------------------------------------

export type DeviceKind = 'phone' | 'tablet' | 'desktop';

/** THIS TABLET, or THE DESKTOP when the page shows another device's. */
export const deviceName = (kind: DeviceKind, own: boolean) =>
	`${own ? 'THIS' : 'THE'} ${kind.toUpperCase()}`;

/** The scope cell's first words. */
export function scopeLabel(row: RowDef, device: string): string {
	if (row.where === 'all') return 'ALL DEVICES';
	if (row.where === 'default') return 'DEFAULT · EVERY DEVICE';
	if (row.where === 'episode') return 'EACH EPISODE';
	return row.control.type === 'zoom' ? `${device} · PER SCREEN` : device;
}

/** The kind of device a browser is, from its screen: what its row in DEVICES is called. */
export function deviceKind(o: { width: number; coarse: boolean }): DeviceKind {
	if (o.width < 600) return 'phone';
	return o.coarse ? 'tablet' : 'desktop';
}

/** "Android tablet · Chrome", from the browser's own words. */
export function deviceLabel(ua: string, kind: DeviceKind): string {
	const os = /Android/i.test(ua)
		? 'Android'
		: /iPhone|iPad|iOS/i.test(ua)
			? 'iOS'
			: /Mac OS X/i.test(ua)
				? 'Mac'
				: /Windows/i.test(ua)
					? 'Windows'
					: /Linux/i.test(ua)
						? 'Linux'
						: '';
	const browser = /Firefox\//.test(ua)
		? 'Firefox'
		: /Edg\//.test(ua)
			? 'Edge'
			: /Chrome\//.test(ua)
				? 'Chrome'
				: /Safari\//.test(ua)
					? 'Safari'
					: 'browser';
	return `${os ? `${os} ${kind}` : kind[0].toUpperCase() + kind.slice(1)} · ${browser}`;
}

/** How many of a device's own rows are off their defaults: "4 CHANGED HERE", a DEVICES row's count. */
export const deviceChanged = (values: Values) =>
	SECTIONS.flatMap((s) => s.rows).filter((r) => r.where === 'device' && rowChanged(r, values))
		.length;
