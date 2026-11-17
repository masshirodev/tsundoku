import type { Token } from './types.ts';

/**
 * The English half of a block, on the device (doc/LANGUAGES.md).
 *
 * English needs no model to find its words: a word is letters with apostrophes
 * and hyphens inside it ("don't", "well-known", "1990s"), and everything
 * between two words is punctuation. That is why this pack has no tokenizer
 * dependency at all, while Japanese needs kuromoji's 12 dictionaries.
 *
 * What English does need a dictionary for is the word *behind* the word: gave
 * is give, mice is mouse. Wiktionary lists those forms itself, so the pack
 * answers them from its own data rather than from a suffix stripper somebody
 * maintains by hand.
 */

/**
 * A word: letters and digits, with apostrophes and hyphens allowed inside.
 * `\p{M}` joins `\p{L}` because a decomposed accent is a letter to a reader.
 */
const WORD = /[\p{L}\p{M}\p{N}]+(?:['’-][\p{L}\p{M}\p{N}]+)*/gu;

/** A number on its own is not a word to look up, though it is a token to draw. */
const HAS_LETTER = /\p{L}/u;

function token(surface: string): Token {
	const word = HAS_LETTER.test(surface);
	return {
		surface,
		lemma: word ? surface.toLowerCase() : surface,
		reading: null,
		pos: '',
		lookupable: word,
		segments: []
	};
}

/**
 * A block as tokens: every word, and the runs of punctuation and space between
 * them, in reading order. A run of gaps is one token so the panel draws it as
 * one stretch of text.
 */
export function segment(text: string): Token[] {
	const out: Token[] = [];
	let at = 0;
	for (const m of text.matchAll(WORD)) {
		const i = m.index ?? 0;
		if (i > at) out.push(token(text.slice(at, i)));
		out.push(token(m[0]));
		at = i + m[0].length;
	}
	if (at < text.length) out.push(token(text.slice(at)));
	return out;
}

/**
 * The words a lookup may run into, in order: the tapped one and up to two
 * after it. The server tries the longest phrase first ("give up" before
 * "give"), so the client only has to pass the text along.
 */
export const LOOKAHEAD = 2;

export function lookahead(after: string, max = LOOKAHEAD): string[] {
	const words: string[] = [];
	for (const m of after.matchAll(WORD)) {
		words.push(m[0]);
		if (words.length >= max) break;
	}
	return words;
}

/**
 * Wiktionary's part of speech, as the panel sets it. Its tags are already
 * short and English ("noun", "adj", "prep"); the panel wants them as the
 * heading it draws, so the abbreviations are spelled out and the rest are
 * uppercased.
 */
const POS_LABELS: Record<string, string> = {
	adj: 'ADJECTIVE',
	adv: 'ADVERB',
	conj: 'CONJUNCTION',
	det: 'DETERMINER',
	intj: 'INTERJECTION',
	name: 'NAME',
	num: 'NUMERAL',
	particle: 'PARTICLE',
	phrase: 'PHRASE',
	prep: 'PREPOSITION',
	pron: 'PRONOUN',
	prop: 'NAME',
	prep_phrase: 'PREPOSITION',
	'prep-phrase': 'PREPOSITION'
};

export function posLabel(pos: string): string {
	const key = pos.trim().toLowerCase();
	return POS_LABELS[key] ?? pos.trim().toUpperCase();
}
