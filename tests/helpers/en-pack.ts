import Database from 'better-sqlite3';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * A five-word English pack, in the shape `scripts/pack-en.ts` writes, for the
 * two places that need one without a 300 MB download: the unit specs
 * (`languages-en.spec.ts`) and the e2e run's preview server
 * (`en-pack-setup.ts`).
 *
 * It is built to answer the cases that decide the rules rather than to be
 * realistic: an exact word beating a form of another word (`saw`), an
 * inflection resolving to its lemma (`gave`), a form's own pointer entry
 * (`mice`), a phrase winning over the word inside it (`give up`), and an
 * archaic sense that must sort under the everyday one (`bark`). The seeded
 * novels' first paragraphs supply the everyday words too (`how`, `large`,
 * `asked`), so the reader's own words can be tapped in an e2e.
 */
export function writeEnglishPack(file: string): void {
	mkdirSync(dirname(file), { recursive: true });
	rmSync(file, { force: true });
	const db = new Database(file);
	db.exec(`
		CREATE TABLE entries (id INTEGER PRIMARY KEY, word TEXT NOT NULL, word_lc TEXT NOT NULL, pos TEXT NOT NULL);
		CREATE TABLE senses (entry_id INTEGER NOT NULL, ord INTEGER NOT NULL, gloss TEXT NOT NULL, pt TEXT, tags TEXT NOT NULL DEFAULT '', form_of TEXT, PRIMARY KEY (entry_id, ord)) WITHOUT ROWID;
		CREATE TABLE forms (form_lc TEXT NOT NULL, entry_id INTEGER NOT NULL, tags TEXT NOT NULL DEFAULT '');
	`);
	const entry = db.prepare('INSERT INTO entries (id, word, word_lc, pos) VALUES (?, ?, ?, ?)');
	const sense = db.prepare(
		'INSERT INTO senses (entry_id, ord, gloss, pt, tags, form_of) VALUES (?, ?, ?, ?, ?, ?)'
	);
	const form = db.prepare('INSERT INTO forms (form_lc, entry_id, tags) VALUES (?, ?, ?)');
	const senseOf = (
		entryId: number,
		ord: number,
		gloss: string,
		extra: { pt?: string; tags?: string; formOf?: string } = {}
	) => sense.run(entryId, ord, gloss, extra.pt ?? null, extra.tags ?? '', extra.formOf ?? null);

	entry.run(1, 'give', 'give', 'verb');
	senseOf(1, 0, 'To transfer the possession of something to someone.');
	senseOf(1, 1, 'To yield slightly when pressed.');
	entry.run(2, 'give up', 'give up', 'verb');
	senseOf(2, 0, 'To surrender.');
	senseOf(2, 1, 'To stop trying.', { pt: 'desistir' });
	entry.run(3, 'dictionary', 'dictionary', 'noun');
	senseOf(3, 0, 'A reference work listing words.');
	entry.run(4, 'saw', 'saw', 'noun');
	senseOf(4, 0, 'A tool with a toothed blade.');
	entry.run(5, 'see', 'see', 'verb');
	senseOf(5, 0, 'To perceive with the eyes.');
	// Wiktionary's own shape for an inflected form: an entry that only points.
	entry.run(6, 'mice', 'mice', 'noun');
	senseOf(6, 0, 'plural of mouse', { tags: 'form-of plural', formOf: 'mouse' });
	entry.run(7, 'mouse', 'mouse', 'noun');
	senseOf(7, 0, 'A small rodent.');
	// An archaic sense that must sort under the everyday one.
	entry.run(8, 'bark', 'bark', 'noun');
	senseOf(8, 0, 'A small ship.', { tags: 'archaic' });
	senseOf(8, 1, 'The noise a dog makes.');
	// The seeded novels' opening lines, so a reader's own words can be tapped.
	entry.run(9, 'large', 'large', 'adj');
	senseOf(9, 0, 'Of considerable or relatively great size.');
	entry.run(10, 'the', 'the', 'det');
	senseOf(10, 0, 'The definite article, naming something already known.');
	entry.run(11, 'ask', 'ask', 'verb');
	senseOf(11, 0, 'To put a question to.');

	form.run('gave', 1, 'past');
	form.run('gives', 1, 'present-singular');
	form.run('given', 1, 'past participle');
	form.run('giv', 1, 'alternative obsolete');
	// A form of another word, so the exact entry for "saw" has to win.
	form.run('saw', 5, 'past');
	form.run('asked', 11, 'past');
	db.close();
}
