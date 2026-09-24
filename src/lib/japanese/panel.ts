/**
 * The lookup panel's rules (doc/JAPANESE.md, "Lookup"), from
 * `Index Japanese.dc.html`. Pure: the panel component and the readers draw
 * from these.
 */

export type Placement =
	/** Portrait, the block in the top half: the panel rises from the bottom. */
	| { kind: 'bottom' }
	/** Portrait, the block in the bottom half: the panel hangs from the top, ruled below. */
	| { kind: 'top' }
	/** Landscape: a 420px column on the side away from the block. */
	| { kind: 'side'; side: 'left' | 'right' }
	/** Phone: from the bottom, the page slid up by `lift` px so the block clears it. */
	| { kind: 'phone'; lift: number };

export const PANEL_H = 600;
export const PANEL_W = 420;
/** Below this width the screen is a phone: the page slides instead. */
export const PHONE_W = 600;
/** Room left between the block and the panel's edge, on a phone. */
const CLEAR = 16;

/**
 * Where the panel goes for a block on screen (`rect`, in px, in a viewport of
 * `vw` × `vh`): the half of the screen away from the block.
 */
export function placement(
	rect: { top: number; bottom: number; left: number; right: number },
	vw: number,
	vh: number
): Placement {
	if (vw < PHONE_W) {
		const panelTop = vh - Math.min(PANEL_H, vh * 0.6);
		return { kind: 'phone', lift: Math.max(0, Math.round(rect.bottom + CLEAR - panelTop)) };
	}
	if (vw > vh) {
		const middle = (rect.left + rect.right) / 2;
		return { kind: 'side', side: middle < vw / 2 ? 'right' : 'left' };
	}
	return (rect.top + rect.bottom) / 2 < vh / 2 ? { kind: 'bottom' } : { kind: 'top' };
}

export type WordCell = {
	/** Index into the tokens. */
	i: number;
	/** A word to tap; false for punctuation and symbols, drawn muted. */
	word: boolean;
};

/** The block's text as cells: a word per lookupable token, punctuation between. */
export function wordCells(tokens: { lookupable: boolean }[]): WordCell[] {
	return tokens.map((t, i) => ({ i, word: t.lookupable }));
}

/** The token first selected: the first word, as the handoff opens on it. */
export function firstWord(tokens: { lookupable: boolean }[]): number {
	const i = tokens.findIndex((t) => t.lookupable);
	return i < 0 ? 0 : i;
}

/**
 * JMdict's part-of-speech codes (jmdict-simplified) as the panel names them:
 * "GODAN VERB · TRANSITIVE". Codes not listed read as themselves, upper case.
 */
const POS: Record<string, string> = {
	n: 'NOUN',
	'n-adv': 'ADVERBIAL NOUN',
	'n-t': 'NOUN (TEMPORAL)',
	'n-suf': 'NOUN SUFFIX',
	'n-pref': 'NOUN PREFIX',
	pn: 'PRONOUN',
	'adj-i': 'I-ADJECTIVE',
	'adj-ix': 'I-ADJECTIVE (YOI/II)',
	'adj-na': 'NA-ADJECTIVE',
	'adj-no': 'NO-ADJECTIVE',
	'adj-pn': 'PRE-NOUN ADJECTIVAL',
	'adj-t': 'TARU-ADJECTIVE',
	'adj-f': 'PRENOMINAL',
	adv: 'ADVERB',
	'adv-to': 'ADVERB (TO)',
	aux: 'AUXILIARY',
	'aux-v': 'AUXILIARY VERB',
	'aux-adj': 'AUXILIARY ADJECTIVE',
	conj: 'CONJUNCTION',
	cop: 'COPULA',
	ctr: 'COUNTER',
	exp: 'EXPRESSION',
	int: 'INTERJECTION',
	num: 'NUMERIC',
	pref: 'PREFIX',
	suf: 'SUFFIX',
	prt: 'PARTICLE',
	v1: 'ICHIDAN VERB',
	'v1-s': 'ICHIDAN VERB (KURERU)',
	v5aru: 'GODAN VERB (ARU)',
	v5b: 'GODAN VERB',
	v5g: 'GODAN VERB',
	v5k: 'GODAN VERB',
	'v5k-s': 'GODAN VERB (IKU)',
	v5m: 'GODAN VERB',
	v5n: 'GODAN VERB',
	v5r: 'GODAN VERB',
	'v5r-i': 'GODAN VERB (IRREGULAR)',
	v5s: 'GODAN VERB',
	v5t: 'GODAN VERB',
	v5u: 'GODAN VERB',
	'v5u-s': 'GODAN VERB (SPECIAL)',
	vk: 'KURU VERB',
	vs: 'SURU VERB',
	'vs-i': 'SURU VERB',
	'vs-s': 'SURU VERB (SPECIAL)',
	vz: 'ZURU VERB',
	vi: 'INTRANSITIVE',
	vt: 'TRANSITIVE'
};

export function posLabel(codes: string[]): string {
	return [...new Set(codes.map((c) => POS[c] ?? c.toUpperCase()))].join(' · ');
}

/** "描いた ← 描く": the form met and the one looked up, when they differ. */
export function inflection(surface: string, lemma: string): string {
	return surface && lemma && surface !== lemma ? `${surface} ← ${lemma}` : '';
}

/** "1ST", "2ND", "3RD", "4TH", "11TH". */
export function ordinal(n: number): string {
	const teen = n % 100 >= 11 && n % 100 <= 13;
	const suffix = teen ? 'TH' : (['TH', 'ST', 'ND', 'RD'][n % 10] ?? 'TH');
	return `${n}${n % 10 > 3 ? 'TH' : suffix}`;
}

/**
 * A block's box on the drawn image, in fractions of it, once a crop takes the
 * image's plain border away (doc/READER.md, "Crop borders"): null when the
 * block falls outside what's shown.
 */
export function boxInCrop(
	box: [number, number, number, number],
	inset: [number, number, number, number] | null
): [number, number, number, number] | null {
	if (!inset) return box;
	const [t, r, b, l] = inset;
	const w = 1 - l - r;
	const h = 1 - t - b;
	const x = (box[0] - l) / w;
	const y = (box[1] - t) / h;
	const bw = box[2] / w;
	const bh = box[3] / h;
	if (x + bw <= 0 || y + bh <= 0 || x >= 1 || y >= 1) return null;
	return [x, y, bw, bh];
}
