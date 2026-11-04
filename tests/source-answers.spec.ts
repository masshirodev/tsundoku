import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { answerCounts, arrangeAnswers, sourceTitle } from '../src/lib/library/source-answers';
import { withLanguages } from '../src/lib/server/move';
import type { Settled } from '../src/lib/library/settled';

/**
 * The order MOVE's candidates and DOWNLOADS' search share (card c490;
 * doc/MOVE.md, "The candidates"): matches first in the order they answered,
 * then the sources still asking, then the empty and the failed, folded.
 */

const S = (id: string, name = `Source ${id}`, lang = 'en') => ({ id, name, lang });
const sources = [S('1'), S('2'), S('3'), S('4'), S('5')];
const ok = (...hits: string[]): Settled<string[]> => ({ ok: true, value: hits });
const no = (error = 'down'): Settled<string[]> => ({ ok: false, error });

describe('arrangeAnswers', () => {
	it('draws the matches in the order they answered, not the list’s', () => {
		const answers = new Map([
			['4', ok('d')],
			['2', ok('b', 'b2')],
			['1', ok('a')]
		]);
		const a = arrangeAnswers(sources, answers);
		expect(a.matches.map((m) => m.source.id)).toEqual(['4', '2', '1']);
		expect(a.matches[1].hits).toEqual(['b', 'b2']);
	});

	it('puts every source in exactly one place, the unmatched in the list’s own order', () => {
		const answers = new Map<string, Settled<string[]>>([
			['5', no()],
			['3', ok()],
			['1', ok('a')],
			['2', no('timeout')]
		]);
		const a = arrangeAnswers(sources, answers);
		expect(a.matches.map((m) => m.source.id)).toEqual(['1']);
		expect(a.asking.map((s) => s.id)).toEqual(['4']);
		expect(a.nothing.map((s) => s.id)).toEqual(['3']);
		expect(a.failed.map((f) => [f.source.id, f.error])).toEqual([
			['2', 'timeout'],
			['5', 'down']
		]);
		const placed = [
			...a.matches.map((m) => m.source.id),
			...a.kept.map((k) => k.source.id),
			...a.asking.map((s) => s.id),
			...a.nothing.map((s) => s.id),
			...a.failed.map((f) => f.source.id)
		].sort();
		expect(placed).toEqual(sources.map((s) => s.id));
	});

	it('asks again by deleting and setting: a retried source answers as the newest', () => {
		const answers = new Map([
			['1', ok('a')],
			['2', no()]
		]);
		answers.delete('2');
		expect(arrangeAnswers(sources, answers).asking.map((s) => s.id)).toContain('2');
		answers.set('2', ok('b'));
		answers.set('3', ok('c'));
		expect(arrangeAnswers(sources, answers).matches.map((m) => m.source.id)).toEqual([
			'1',
			'2',
			'3'
		]);
	});

	it('keeps the chosen candidate’s source in sight whatever it answered', () => {
		const failed = arrangeAnswers(sources, new Map([['2', no()]]), '2');
		expect(failed.kept.map((k) => k.source.id)).toEqual(['2']);
		expect(failed.failed).toEqual([]);
		const empty = arrangeAnswers(sources, new Map([['2', ok()]]), '2');
		expect(empty.kept.map((k) => k.source.id)).toEqual(['2']);
		expect(empty.nothing).toEqual([]);
		// With hits it is a match like any other.
		const hit = arrangeAnswers(sources, new Map([['2', ok('b')]]), '2');
		expect(hit.kept).toEqual([]);
		expect(hit.matches.map((m) => m.source.id)).toEqual(['2']);
	});

	it('ignores an answer from a source the list no longer asks', () => {
		const a = arrangeAnswers(sources, new Map([['9', ok('z')]]));
		expect(a.matches).toEqual([]);
		expect(a.asking).toHaveLength(5);
	});

	it('is the same for every arrival order of the same answers, matches aside', () => {
		const all: [string, Settled<string[]>][] = [
			['1', ok('a')],
			['2', ok()],
			['3', no()],
			['4', ok('d')],
			['5', ok()]
		];
		const orders = [all, [...all].reverse(), [all[2], all[0], all[4], all[1], all[3]]];
		const seen = orders.map((o) => {
			const a = arrangeAnswers(sources, new Map(o));
			return {
				nothing: a.nothing.map((s) => s.id),
				failed: a.failed.map((f) => f.source.id),
				matches: a.matches.map((m) => m.source.id).sort()
			};
		});
		expect(seen[1]).toEqual(seen[0]);
		expect(seen[2]).toEqual(seen[0]);
	});
});

describe('answerCounts', () => {
	it('counts an empty answer as answered and a failure as not', () => {
		expect(
			answerCounts(
				new Map([
					['1', ok('a', 'b')],
					['2', ok()],
					['3', no()]
				])
			)
		).toEqual({ answered: 2, found: 2 });
		expect(answerCounts(new Map())).toEqual({ answered: 0, found: 0 });
	});
});

describe('sourceTitle', () => {
	it('names a source with its language, and alone without one', () => {
		expect(sourceTitle(S('1', 'MangaDex', 'en'))).toBe('MANGADEX · EN');
		expect(sourceTitle(S('2', 'MangaDex', 'pt-BR'))).toBe('MANGADEX · PT-BR');
		expect(sourceTitle(S('3', 'Good Novels', 'English'))).toBe('GOOD NOVELS · ENGLISH');
		expect(sourceTitle({ id: '4', name: 'Bare' })).toBe('BARE');
		expect(sourceTitle(S('5', 'Blank', '  '))).toBe('BLANK');
	});
});

describe('withLanguages', () => {
	it('reads an extension’s source from engine_sources and a plugin from novel_plugins', () => {
		const db = new Database(':memory:');
		db.exec(`CREATE TABLE engine_sources (id TEXT PRIMARY KEY, lang TEXT);
			CREATE TABLE novel_plugins (id TEXT PRIMARY KEY, lang TEXT);
			INSERT INTO engine_sources VALUES ('101', 'en'), ('102', 'pt-BR'), ('103', NULL);
			INSERT INTO novel_plugins VALUES ('shelf', 'English');`);
		const got = withLanguages(
			[
				{ id: '101', name: 'MangaDex' },
				{ id: '102', name: 'MangaDex' },
				{ id: '103', name: 'No Language' },
				{ id: 'ln:shelf', name: 'Shelf' },
				{ id: '999', name: 'Gone' }
			],
			db
		);
		expect(got.map((s) => [s.id, s.name, s.lang])).toEqual([
			['101', 'MangaDex', 'en'],
			['102', 'MangaDex', 'pt-BR'],
			['103', 'No Language', ''],
			['ln:shelf', 'Shelf', 'English'],
			['999', 'Gone', '']
		]);
		db.close();
	});
});
