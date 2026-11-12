/**
 * What a language pack answers, in one shape (doc/LANGUAGES.md, c195; c198).
 *
 * The reader and the lookup panel draw these and never ask which language
 * produced them: Japanese fills a reading and ruby, English fills a phrase and
 * leaves the reading null, and a language with neither sets the same fields to
 * null rather than leaving them out.
 *
 * Pure types only: this file is imported by the reader's device as well as the
 * workstation, so nothing here may reach for node.
 */

/** One piece of text and the ruby over it, as the panel sets a word. */
export type RubySegment = { text: string; ruby: string | null };

/**
 * A drawable piece of the block: a word, or the punctuation between words.
 * The same shape the Japanese tokenizer has always returned, widened so a
 * language without readings or ruby can say so.
 */
export type Token = {
	surface: string;
	lemma: string;
	reading: string | null;
	pos: string;
	/** Punctuation and symbols are drawn muted and never looked up. */
	lookupable: boolean;
	segments: RubySegment[];
};

/** The languages a gloss may be written in (c200: English, PT-BR, or both). */
export type GlossLang = 'en' | 'pt';

export type Gloss = { lang: GlossLang; text: string };

export type Sense = {
	pos: string[];
	glosses: Gloss[];
};

export type Source = { name: string; licence: string; url: string };

export type Entry = {
	/** The word or phrase this entry defines: "give", "give up". */
	headword: string;
	reading: string | null;
	/**
	 * Senses in the dictionary's own order. The panel draws each entry whole,
	 * so a phrase entry and the single word inside it are two entries in the
	 * list rather than two halves of one.
	 */
	senses: Sense[];
	/** Where the entry came from, and under what licence: drawn on every entry. */
	source: Source;
};

export type PackId = 'ja' | 'en';
