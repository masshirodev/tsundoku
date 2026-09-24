import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const path = process.env.KOTOBA_JMDICT ?? join(homedir(), '.local', 'share', 'kotoba', 'jmdict.db');
const { define, dictionaryAvailable } = await import('$lib/server/japanese/dict');

/** Words from Sakamoto Days' first chapter, as mokuro read them. Skipped without JMdict. */
describe.skipIf(!existsSync(path))('looking words up through kotoba', () => {
	it('finds JMdict', () => {
		expect(dictionaryAvailable()).toBe(true);
	});

	it('finds a word by its dictionary form, with readings and meanings', () => {
		const [first] = define({ lemma: '殺し屋' });
		expect(first.kana).toContain('ころしや');
		expect(first.senses[0].gloss.join(' ')).toMatch(/killer|assassin/i);
	});

	it('falls back to the surface, then the reading', () => {
		expect(define({ lemma: 'ないもの', surface: '弓矢' }).length).toBeGreaterThan(0);
		expect(define({ lemma: 'ないもの', reading: 'ゆみや' }).length).toBeGreaterThan(0);
	});

	it('answers at most three entries', () => {
		expect(define({ lemma: 'かける' }).length).toBeLessThanOrEqual(3);
	});
});
