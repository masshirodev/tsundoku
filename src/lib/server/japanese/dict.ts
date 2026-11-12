import { homedir } from 'node:os';
import { join } from '../fspath.ts';
import { dictionaryAvailable, lookup, setJmdictPath } from 'kotoba/server';
import type { Entry as PackEntry } from '../../languages/types.ts';

/**
 * JMdict, through kotoba (doc/JAPANESE.md): the one database yomu and
 * tsundoku both read, `KOTOBA_JMDICT`, else `~/.local/share/kotoba/jmdict.db`
 * (built with `kotoba-build-dict`). Without it a lookup answers nothing.
 */
setJmdictPath(
	process.env.KOTOBA_JMDICT ?? join(homedir(), '.local', 'share', 'kotoba', 'jmdict.db')
);

export { dictionaryAvailable };

/** The line every Japanese entry ends with (doc/LANGUAGES.md; the handoff's Main 104). */
const SOURCE = {
	name: 'JMdict · EDRDG',
	licence: 'CC BY-SA 4.0',
	url: 'https://www.edrdg.org/jmdict/j_jmdict.html'
} as const;

export type JmdictQuery = { lemma: string; surface?: string; reading?: string };

/**
 * A tapped word's entries, in the pack's own shape (doc/LANGUAGES.md): the
 * panel draws these and never asks which dictionary answered, so JMdict's
 * kanji/kana/gloss arrays are folded into headword, reading and tagged
 * glosses here rather than in the panel.
 *
 * Up to three entries, common ones first, tried by dictionary form, then as
 * written, then as read. There's no deinflection of its own: kuromoji's base
 * form already turns 見開かれて into 見開く.
 */
export function define(q: JmdictQuery): PackEntry[] {
	return lookupJmdict(q).map((e) => ({
		headword: e.kanji[0] ?? q.lemma,
		reading: (e.kana.length ? e.kana : q.reading ? [q.reading] : []).join(' · ') || null,
		common: e.common,
		senses: e.senses.map((s) => ({
			pos: s.pos,
			// JMdict's glosses are English; a PT-BR pack is c200's work.
			glosses: s.gloss.map((text) => ({ lang: 'en' as const, text }))
		})),
		source: SOURCE
	}));
}

/**
 * JMdict's own entries, for the one caller that needs them rather than a
 * panel: mining builds a flashcard out of kanji, kana and gloss arrays
 * (`mining.ts`). Japanese-only by design — a pack's other language mines
 * through c203, not here.
 */
export function lookupJmdict(q: JmdictQuery) {
	return lookup(q.lemma, q.surface, q.reading).slice(0, 3);
}
