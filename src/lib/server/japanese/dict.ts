import { homedir } from 'node:os';
import { join } from 'node:path';
import { dictionaryAvailable, lookup, setJmdictPath, type Entry } from 'kotoba/server';

/**
 * JMdict, through kotoba (doc/JAPANESE.md): the one database yomu and
 * tsundoku both read, `KOTOBA_JMDICT`, else `~/.local/share/kotoba/jmdict.db`
 * (built with `kotoba-build-dict`). Without it a lookup answers nothing.
 */
setJmdictPath(
	process.env.KOTOBA_JMDICT ?? join(homedir(), '.local', 'share', 'kotoba', 'jmdict.db')
);

export { dictionaryAvailable, type Entry };

/** A tapped word's entries: its dictionary form first, then as written, then as read. */
export function define(q: { lemma: string; surface?: string; reading?: string }): Entry[] {
	return lookup(q.lemma, q.surface, q.reading).slice(0, 3);
}
