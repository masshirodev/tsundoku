import { tokenize } from 'kotoba';
import { inflection as inflectionJa, posLabel as posLabelJa } from '$lib/japanese/panel';
import { posLabel as posLabelEn, segment as segmentEn } from './en.ts';
import type { PackId, Token } from './types.ts';

/**
 * The packs the reader can ask, and what the panel needs to draw one
 * (doc/LANGUAGES.md, c195). A pack is the only place a language is known: the
 * panel asks this registry for a face, a wording and a query, never whether it
 * is looking at Japanese.
 */

export type { Entry, Gloss, GlossLang, PackId, Sense, Source, Token } from './types.ts';

export type Pack = {
	id: PackId;
	/** BCP 47, on the words row and the headword, so a screen reader says it right. */
	lang: string;
	/** The words row's face and size: Japanese has its own (Main 175). */
	words: { family: string; size: string };
	/** The dictionary's name, for the sentence that says where meanings live. */
	dictionary: string;
	/** The block as words, on the device: kuromoji for Japanese, a split for English. */
	segment(text: string): Promise<Token[]>;
	posLabel(pos: string[]): string;
	/** "描いた ← 描く", "gave ← give"; empty when the word met is the word answered. */
	inflection(surface: string, lemma: string, headword: string | null): string;
	/** The define query for a tap. Each dictionary takes its own fields. */
	query(token: Token, after: string): URLSearchParams;
};

const ja: Pack = {
	id: 'ja',
	lang: 'ja',
	words: { family: "'IBM Plex Sans JP', var(--font-sans)", size: '30px' },
	dictionary: 'JMdict',
	segment: (text) => tokenize(text),
	posLabel: posLabelJa,
	inflection: (surface, lemma) => inflectionJa(surface, lemma),
	query: (token) =>
		new URLSearchParams({
			lemma: token.lemma,
			surface: token.surface,
			...(token.reading ? { reading: token.reading } : {})
		})
};

const en: Pack = {
	id: 'en',
	lang: 'en',
	words: { family: 'var(--font-sans)', size: '24px' },
	dictionary: 'Wiktionary',
	segment: async (text) => segmentEn(text),
	posLabel: (pos) => (pos[0] ? posLabelEn(pos[0]) : ''),
	// The pack answers an inflection with its lemma, so that is what the line
	// names: the panel's own `lemma` is only the surface lowercased (c198).
	inflection: (surface, _lemma, headword) =>
		headword && headword.toLowerCase() !== surface.toLowerCase() ? `${surface} ← ${headword}` : '',
	query: (token, after) => new URLSearchParams({ surface: token.surface, after })
};

export const packs = { ja, en } as const;

/**
 * The pack that reads a series' language, or null when none does: an untagged
 * language, or one with no pack yet, shows no LOOK UP at all rather than a
 * panel that answers nothing.
 */
export function packFor(locale: string | null | undefined): Pack | null {
	if (!locale) return null;
	if (/^ja\b/i.test(locale)) return ja;
	if (/^en\b/i.test(locale)) return en;
	return null;
}
