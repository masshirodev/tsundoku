import { describe, expect, it } from 'vitest';
import {
	originLabel,
	searchOrigin,
	seriesWithOrigin,
	sourceOrigin
} from '../src/lib/library/origin';

/** Where a preview was opened from, kept through + ADD. */
describe('sourceOrigin', () => {
	it('keeps a source’s BROWSE page and the search, query included', () => {
		expect(sourceOrigin('/browse/12')).toBe('/browse/12');
		expect(sourceOrigin('/browse/12?q=linden&page=2')).toBe('/browse/12?q=linden&page=2');
		expect(sourceOrigin('/downloads/search')).toBe('/downloads/search');
		expect(sourceOrigin('/downloads/search?q=a%20b')).toBe('/downloads/search?q=a%20b');
	});

	it('refuses anything that would make ← an open redirect', () => {
		for (const raw of [
			'https://evil.example/browse/1',
			'//evil.example/browse/1',
			'/\\evil.example/browse/1',
			'javascript:alert(1)',
			'browse/1',
			' /browse/1'
		])
			expect(sourceOrigin(raw), raw).toBe('');
	});

	it('refuses other screens of the app, and paths that climb out of BROWSE', () => {
		expect(sourceOrigin('/')).toBe('');
		expect(sourceOrigin('/settings')).toBe('');
		expect(sourceOrigin('/browse')).toBe('');
		expect(sourceOrigin('/browse/../settings')).toBe('');
		expect(sourceOrigin('/downloads/search/x')).toBe('');
		expect(sourceOrigin('/downloads/searchx')).toBe('');
	});

	it('answers nothing for nothing', () => {
		expect(sourceOrigin(null)).toBe('');
		expect(sourceOrigin(undefined)).toBe('');
		expect(sourceOrigin('')).toBe('');
	});
});

describe('originLabel and searchOrigin', () => {
	it('names BROWSE for a source’s page and SOURCES for the search', () => {
		expect(originLabel('/browse/3')).toBe('Browse');
		expect(originLabel('/downloads/search?q=x')).toBe('Sources');
	});

	it('builds the search, with its query when there is one', () => {
		expect(searchOrigin('')).toBe('/downloads/search');
		expect(searchOrigin('a b&c')).toBe('/downloads/search?q=a%20b%26c');
	});
});

describe('seriesWithOrigin', () => {
	it('adds the origin after the other parameters, encoded', () => {
		expect(seriesWithOrigin(7, '/browse/3?q=x', { added: '3~abc' })).toBe(
			'/series/7?added=3%7Eabc&from=%2Fbrowse%2F3%3Fq%3Dx'
		);
		expect(seriesWithOrigin(7, '/downloads/search')).toBe('/series/7?from=%2Fdownloads%2Fsearch');
	});

	it('leaves out an origin that isn’t one', () => {
		expect(seriesWithOrigin(7, 'https://evil.example', { added: '1' })).toBe('/series/7?added=1');
		expect(seriesWithOrigin(7, '')).toBe('/series/7');
	});
});
