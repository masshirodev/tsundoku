/**
 * Build the English lookup pack (doc/LANGUAGES.md, c195; c198) from kaikki.org's
 * English Wiktionary extract: a JSONL file, one entry per line, ~1M of them.
 *
 *   yarn run pack:en --in ~/packs/English.jsonl.gz --out ~/packs/en-wiktionary.db
 *
 * Why kaikki and not the dump: it is the same Wiktionary text, already parsed
 * into JSON, under the same licence (CC BY-SA 3.0), and it carries the two
 * things a reader's lookup needs that the raw dump does not have ready: every
 * inflected form of a word, and the multiword entries ("give up") as words of
 * their own.
 *
 * **There is no lemmatiser.** English Wiktionary lists the forms of a word
 * (gave, given, gives, giving under give), including the regular ones, so the
 * forms table answers "gave" without a language model guessing at "give". That
 * is also what makes the pack a *pack*: the rules for the language live in the
 * data, not in a list of suffixes somebody maintains by hand.
 *
 * Only what a lookup reads is kept. Etymology trees, descendants, sounds and
 * categories are most of the file's bytes and none of a definition.
 */
import { createReadStream, existsSync, renameSync, rmSync, statSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import Database from 'better-sqlite3';

type KaikkiSense = {
	glosses?: string[];
	tags?: string[];
	/** Set when the sense is only a pointer at another word ("gave" → give). */
	form_of?: { word?: string }[];
	translations?: { lang_code?: string; word?: string }[];
};

type KaikkiTranslation = {
	lang_code?: string;
	word?: string;
	sense?: string;
};

type KaikkiEntry = {
	word?: string;
	lang_code?: string;
	pos?: string;
	forms?: { form?: string; tags?: string[] }[];
	senses?: KaikkiSense[];
	translations?: KaikkiTranslation[];
};

const args = process.argv.slice(2);
const arg = (name: string): string | undefined => {
	const i = args.indexOf(`--${name}`);
	return i === -1 ? undefined : args[i + 1];
};

const input = arg('in');
const output = arg('out');
/** Stop after N entries: enough to test the pipe without building 500 MB. */
const limit = Number(arg('limit') ?? 0);

if (!input || !output) {
	console.error('usage: pack:en --in <English.jsonl.gz> --out <en-wiktionary.db> [--limit N]');
	process.exit(2);
}
if (!existsSync(input)) {
	console.error(`pack:en: no such file: ${input}`);
	process.exit(2);
}

// A half-written pack must never be mistaken for a finishing one, so the build
// writes beside the target and moves it into place at the end.
const scratch = `${output}.building`;
for (const p of [scratch, `${scratch}-journal`, `${scratch}-wal`, `${scratch}-shm`]) {
	if (existsSync(p)) rmSync(p);
}

const db = new Database(scratch);
db.pragma('journal_mode = OFF');
db.pragma('synchronous = OFF');

db.exec(`
	CREATE TABLE entries (
		id INTEGER PRIMARY KEY,
		word TEXT NOT NULL,
		/** Lowercased, for lookup: a sentence may capitalise, the dictionary does not. */
		word_lc TEXT NOT NULL,
		pos TEXT NOT NULL
	);
	CREATE TABLE senses (
		entry_id INTEGER NOT NULL,
		ord INTEGER NOT NULL,
		gloss TEXT NOT NULL,
		/** The sense's Portuguese translation, when Wiktionary has one (c200). */
		pt TEXT,
		/** Wiktionary's own tags: "archaic", "figurative", "form-of". */
		tags TEXT NOT NULL DEFAULT '',
		/** The word this sense only points at ("gave" → give), followed, never shown. */
		form_of TEXT,
		PRIMARY KEY (entry_id, ord)
	) WITHOUT ROWID;
	CREATE TABLE forms (
		form_lc TEXT NOT NULL,
		entry_id INTEGER NOT NULL,
		/** Wiktionary's tags, kept so an "obsolete" spelling can sort last. */
		tags TEXT NOT NULL DEFAULT ''
	);
`);

const insertEntry = db.prepare('INSERT INTO entries (id, word, word_lc, pos) VALUES (?, ?, ?, ?)');
const insertSense = db.prepare(
	'INSERT INTO senses (entry_id, ord, gloss, pt, tags, form_of) VALUES (?, ?, ?, ?, ?, ?)'
);
const insertForm = db.prepare('INSERT INTO forms (form_lc, entry_id, tags) VALUES (?, ?, ?)');

let entries = 0;
let senses = 0;
let forms = 0;
let skipped = 0;
const started = Date.now();

/** A gloss with the wiki markup a reader should not see, and the HTML entities Wiktionary keeps. */
function clean(text: string): string {
	return text
		.replace(/<[^>]+>/g, '')
		.replace(/&quot;/g, '"')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/\s+/g, ' ')
		.trim();
}

const write = db.transaction((rows: KaikkiEntry[]) => {
	for (const e of rows) {
		const word = e.word?.trim();
		const pos = e.pos?.trim();
		if (!word || !pos) {
			skipped++;
			continue;
		}
		if (e.lang_code && e.lang_code !== 'en') {
			skipped++;
			continue;
		}
		const kept = (e.senses ?? [])
			.map((s) => {
				const gloss = s.glosses?.map(clean).filter(Boolean).join('; ');
				if (!gloss) return null;
				const pt = s.translations?.find((t) => t.lang_code === 'pt')?.word?.trim() || null;
				const formOf = s.form_of?.[0]?.word?.trim() ?? null;
				return { gloss, pt, tags: (s.tags ?? []).join(' '), formOf };
			})
			.filter(
				(s): s is { gloss: string; pt: string | null; tags: string; formOf: string | null } =>
					s !== null
			);
		if (!kept.length) {
			skipped++;
			continue;
		}

		entries++;
		const id = entries;
		insertEntry.run(id, word, word.toLowerCase(), pos);
		kept.forEach((s, i) => {
			senses++;
			insertSense.run(id, i, s.gloss, s.pt, s.tags, s.formOf);
		});
		for (const f of e.forms ?? []) {
			const form = f.form?.trim();
			if (!form || form.toLowerCase() === word.toLowerCase()) continue;
			forms++;
			insertForm.run(form.toLowerCase(), id, (f.tags ?? []).join(' '));
		}
	}
});

const lines = createInterface({
	input: createReadStream(input).pipe(createGunzip()),
	crlfDelay: Infinity
});

let batch: KaikkiEntry[] = [];
for await (const line of lines) {
	if (!line.trim()) continue;
	let entry: KaikkiEntry;
	try {
		entry = JSON.parse(line) as KaikkiEntry;
	} catch {
		skipped++;
		continue;
	}
	batch.push(entry);
	if (batch.length >= 2000) {
		write(batch);
		batch = [];
		if (limit && entries >= limit) break;
		if (entries % 100000 === 0) {
			const s = Math.round((Date.now() - started) / 1000);
			console.log(`  ${entries} entries · ${senses} senses · ${forms} forms · ${s}s`);
		}
	}
}
if (batch.length && !(limit && entries >= limit)) write(batch);

console.log('indexing…');
db.exec(`
	CREATE INDEX entries_word ON entries(word_lc);
	CREATE INDEX senses_entry ON senses(entry_id);
	CREATE INDEX forms_form ON forms(form_lc);
	VACUUM;
`);

// The move is the commit: a reader sees either the old pack or the new one.
db.close();
rmSync(output, { force: true });
renameSync(scratch, output);

const secs = Math.round((Date.now() - started) / 1000);
const size = (statSync(output).size / 1_000_000).toFixed(0);
console.log(
	`pack:en: ${entries} entries, ${senses} senses, ${forms} forms (${skipped} skipped) in ${secs}s, ${size} MB`
);
// A stream of zero would leave a pack that answers nothing; keep the exit code honest.
if (!entries) {
	console.error('pack:en: no entries were written');
	process.exit(1);
}
