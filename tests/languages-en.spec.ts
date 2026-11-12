import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { lookahead, posLabel, segment } from '$lib/languages/en';
import { available, define, setPackPath } from '$lib/server/languages/en';

/**
 * The English pack's two halves: the words a block splits into on the device,
 * and the entries the pack answers on the workstation (doc/LANGUAGES.md, c198).
 *
 * The fixture is the shape `scripts/pack-en.ts` writes, cut down to the cases
 * that decide the rules: an exact word beating a form of another word, an
 * inflection resolving to its lemma, and a phrase winning over the word inside
 * it.
 */

const dirs: string[] = [];

function mapDatabase() {
	// os.tmpdir() is RAM on the workstation, so each fixture is removed below.
	const dir = mkdtempSync(join(tmpdir(), 'tsundoku-en-'));
	dirs.push(dir);
	const file = join(dir, 'en-wiktionary.db');
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
	form.run('gave', 1, 'past');
	form.run('gives', 1, 'present-singular');
	form.run('given', 1, 'past participle');
	form.run('giv', 1, 'alternative obsolete');
	// A form of another word, so the exact entry for "saw" has to win.
	form.run('saw', 5, 'past');
	db.close();
	return file;
}

afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
	setPackPath(join(tmpdir(), 'no-such-pack.db'));
});

describe('segmenting English', () => {
	it('gives words and the gaps between them, punctuation drawn but not looked up', () => {
		const tokens = segment('He gave up, don’t ask.');
		expect(tokens.map((t) => t.surface)).toEqual([
			'He',
			' ',
			'gave',
			' ',
			'up',
			', ',
			'don’t',
			' ',
			'ask',
			'.'
		]);
		expect(tokens.filter((t) => t.lookupable).map((t) => t.surface)).toEqual([
			'He',
			'gave',
			'up',
			'don’t',
			'ask'
		]);
	});

	it('keeps hyphens and apostrophes inside a word, and a bare number out of the lookup', () => {
		const tokens = segment('A well-known 1990s novel’s end: 42');
		expect(tokens.filter((t) => t.lookupable).map((t) => t.surface)).toEqual([
			'A',
			'well-known',
			'1990s',
			'novel’s',
			'end'
		]);
		expect(tokens.at(-1)?.surface).toBe('42');
		expect(tokens.at(-1)?.lookupable).toBe(false);
	});

	it('carries no reading and no ruby: English has none to give', () => {
		for (const t of segment('word')) {
			expect(t.reading).toBeNull();
			expect(t.segments).toEqual([]);
		}
	});

	it('looks two words ahead, and no further', () => {
		expect(lookahead(' up the fight')).toEqual(['up', 'the']);
		expect(lookahead(' up')).toEqual(['up']);
		expect(lookahead('')).toEqual([]);
	});

	it('spells out the parts of speech Wiktionary abbreviates', () => {
		expect(posLabel('adj')).toBe('ADJECTIVE');
		expect(posLabel('prep')).toBe('PREPOSITION');
		expect(posLabel('noun')).toBe('NOUN');
		expect(posLabel('name')).toBe('NAME');
	});
});

describe('defining English', () => {
	it('answers an exact word with its senses, and names the source', () => {
		setPackPath(mapDatabase());
		expect(available()).toBe(true);
		const [entry] = define({ surface: 'dictionary' });
		expect(entry.headword).toBe('dictionary');
		expect(entry.senses[0].pos).toEqual(['noun']);
		expect(entry.senses[0].glosses).toEqual([
			{ lang: 'en', text: 'A reference work listing words.' }
		]);
		expect(entry.source).toEqual({
			name: 'Wiktionary',
			licence: 'CC BY-SA 3.0',
			url: 'https://en.wiktionary.org/'
		});
	});

	it('resolves an inflection to its lemma through the pack’s own forms', () => {
		setPackPath(mapDatabase());
		expect(define({ surface: 'gave' })[0].headword).toBe('give');
	});

	it('lets a word that exists win over a form of another word', () => {
		setPackPath(mapDatabase());
		expect(define({ surface: 'saw' })[0].headword).toBe('saw');
	});

	it('follows a form’s own entry to the word it points at, instead of printing the pointer', () => {
		setPackPath(mapDatabase());
		const [entry] = define({ surface: 'mice' });
		expect(entry.headword).toBe('mouse');
		expect(entry.senses[0].glosses[0].text).toBe('A small rodent.');
	});

	it('puts an archaic sense under the everyday one', () => {
		setPackPath(mapDatabase());
		const [entry] = define({ surface: 'bark' });
		expect(entry.senses.map((s) => s.glosses[0].text)).toEqual([
			'The noise a dog makes.',
			'A small ship.'
		]);
	});

	it('prefers a phrase the lookahead completes, then shows the word inside it', () => {
		setPackPath(mapDatabase());
		const entries = define({ surface: 'gave', after: ' up the fight' });
		expect(entries.map((e) => e.headword)).toEqual(['give up', 'give']);
	});

	it('carries a Portuguese gloss when the sense has one (c200)', () => {
		setPackPath(mapDatabase());
		const [entry] = define({ surface: 'give up' });
		expect(entry.senses[1].glosses).toEqual([
			{ lang: 'en', text: 'To stop trying.' },
			{ lang: 'pt', text: 'desistir' }
		]);
	});

	it('answers nothing, rather than failing, without a pack', () => {
		setPackPath(join(tmpdir(), 'no-such-pack.db'));
		expect(available()).toBe(false);
		expect(define({ surface: 'dictionary' })).toEqual([]);
	});
});
