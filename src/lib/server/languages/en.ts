import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { dataPaths } from '../data-dirs.ts';
import { join } from '../fspath.ts';
import { lookahead } from '../../languages/en.ts';
import type { Entry, Gloss, Sense } from '../../languages/types.ts';

/**
 * English definitions, from the pack `scripts/pack-en.ts` builds out of
 * kaikki.org's English Wiktionary extract (doc/LANGUAGES.md, c198).
 *
 * Read-only and opened lazily, like JMdict in kotoba: a missing pack means
 * "no definitions", never a reader that will not open. The panel says so on
 * the entry rather than the reader failing.
 *
 * The lookup answers in this order, and stops at the first that hits:
 *
 *   1. the span as written ("give up", "dictionary");
 *   2. its first word through the pack's forms ("gave" → give, "mice" → mouse),
 *      with the rest of the span kept ("gave up" → "give up");
 *   3. shorter spans, so a tap on "give" with no entry of its own still lands
 *      on "give up" (c198: a multiword match and the single word under it).
 *
 * No lemmatiser runs here: the forms table *is* the English inflection list,
 * taken from Wiktionary rather than guessed at.
 */

const SOURCE = {
	name: 'Wiktionary',
	licence: 'CC BY-SA 4.0',
	url: 'https://en.wiktionary.org/'
} as const;

/** A tap offers a phrase and the word inside it; more than that is noise. */
const MAX_ENTRIES = 3;
const MAX_SENSES = 6;

let packPath: string | null = null;
let db: Database.Database | null = null;
let checked = false;

function path(): string {
	packPath ??= process.env.TSUNDOKU_EN_PACK ?? join(dataPaths().packs, 'en-wiktionary.db');
	return packPath;
}

/**
 * Where the English pack is, for a test or a hand-built one. Call before the
 * first lookup, or again to switch: the next lookup opens the new file.
 */
export function setPackPath(next: string): void {
	packPath = next;
	db?.close();
	db = null;
	checked = false;
	// Statements belong to the connection that prepared them.
	statements.clear();
}

function open(): Database.Database | null {
	if (checked) return db;
	checked = true;
	const file = path();
	if (!existsSync(file)) return null;
	db = new Database(file, { readonly: true, fileMustExist: true });
	return db;
}

/** Whether the pack is there at all: the panel's LOOK UP is left out without one. */
export function available(): boolean {
	return open() !== null;
}

type Row = { id: number; word: string; pos: string };

const statements = new Map<string, Database.Statement>();

function query(sql: string): Database.Statement {
	const cached = statements.get(sql);
	if (cached) return cached;
	const made = (db as Database.Database).prepare(sql);
	statements.set(sql, made);
	return made;
}

function exact(span: string): Row[] {
	const d = open();
	if (!d) return [];
	return query('SELECT id, word, pos FROM entries WHERE word_lc = ? ORDER BY id LIMIT 8').all(
		span
	) as Row[];
}

/**
 * Entries a form points at. A real word always wins over a form (exact() runs
 * first), so only the spelling's own entries are ranked: an obsolete or
 * alternative spelling goes after a plain inflection.
 */
function forms(word: string): Row[] {
	const d = open();
	if (!d) return [];
	return query(
		`SELECT e.id, e.word, e.pos
		   FROM forms f JOIN entries e ON e.id = f.entry_id
		  WHERE f.form_lc = ?
		  ORDER BY (f.tags LIKE '%obsolete%' OR f.tags LIKE '%alternative%' OR f.tags LIKE '%misspelling%'), e.id
		  LIMIT 8`
	).all(word) as Row[];
}

function sensesOf(id: number): Sense[] {
	const rows = query(
		`SELECT gloss, pt, tags FROM senses WHERE entry_id = ?
		  ORDER BY (tags LIKE '%archaic%' OR tags LIKE '%obsolete%' OR tags LIKE '%rare%' OR tags LIKE '%dated%'), ord
		  LIMIT ?`
	).all(id, MAX_SENSES) as { gloss: string; pt: string | null; tags: string }[];
	const seen = new Set<string>();
	const out: Sense[] = [];
	for (const r of rows) {
		// Wiktionary repeats a gloss under more than one etymology; one is enough.
		if (seen.has(r.gloss)) continue;
		seen.add(r.gloss);
		const glosses: Gloss[] = [{ lang: 'en', text: r.gloss }];
		if (r.pt) glosses.push({ lang: 'pt', text: r.pt });
		out.push({ pos: [], glosses });
	}
	return out;
}

/**
 * The word a form's entry only points at ("gave" → give), or null when the
 * entry has senses of its own. Wiktionary writes one entry per inflected form,
 * whose whole content is "simple past of give"; printing that would be a
 * lookup that answers nothing, so the pointer is followed instead.
 */
function pointerTo(id: number): string | null {
	const r = query(
		`SELECT COUNT(*) AS total, COUNT(form_of) AS pointers, MIN(form_of) AS target
		   FROM senses WHERE entry_id = ?`
	).get(id) as { total: number; pointers: number; target: string | null };
	return r.total > 0 && r.total === r.pointers ? r.target : null;
}

function resolve(row: Row, depth = 0): Row[] {
	if (depth >= 3) return [row];
	const target = pointerTo(row.id);
	if (!target) return [row];
	return exact(target.toLowerCase()).flatMap((r) => resolve(r, depth + 1));
}

function entryOf(row: Row): Entry {
	const senses = sensesOf(row.id).map((s) => ({ ...s, pos: [row.pos] }));
	return { headword: row.word, reading: null, senses, source: SOURCE };
}

/** Entries whose word is the span, with a form's own entry followed to its lemma. */
function exactResolved(span: string): Row[] {
	return exact(span).flatMap((r) => resolve(r));
}

function find(span: string): Row[] {
	const direct = exactResolved(span);
	if (direct.length) return direct;
	const [head, ...rest] = span.split(' ');
	const lemmas = forms(head);
	if (!rest.length) return lemmas;
	for (const lemma of lemmas) {
		const phrase = exact([lemma.word.toLowerCase(), ...rest].join(' '));
		if (phrase.length) return phrase;
	}
	return [];
}

export type EnQuery = {
	/** The tapped word, as it appears in the block. */
	surface: string;
	/** The text after it: the server looks up to two words on ("give up"). */
	after?: string;
};

/** The entries a tap on `surface` should show, phrase first. */
export function define({ surface, after = '' }: EnQuery): Entry[] {
	if (!open()) return [];
	const first = surface.trim().toLowerCase();
	if (!first) return [];

	const words = [first, ...lookahead(after).map((w) => w.toLowerCase())];
	for (let n = words.length; n >= 1; n--) {
		const rows = find(words.slice(0, n).join(' '));
		if (!rows.length) continue;
		const found = rows.map(entryOf);
		// The phrase answers the tap, and the word inside it is worth showing
		// under it, because a reader may have tapped only part of it (c198).
		if (n > 1) {
			for (const row of find(first)) {
				if (!found.some((e) => e.headword === row.word && e.senses[0]?.pos[0] === row.pos))
					found.push(entryOf(row));
			}
		}
		return found.slice(0, MAX_ENTRIES);
	}
	return [];
}
