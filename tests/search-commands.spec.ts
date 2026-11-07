import { describe, expect, it } from 'vitest';
import { parseBar, parseSearch } from '$lib/library/search';

/**
 * The one parser every top search bar shares (card c697). A bar's own filter
 * is `filter`; a command runs where the bar is; a page opens; a `/`-led string
 * that names neither is `unknown`, never silently filtered for.
 */
describe('a top search bar (c697)', () => {
	it('runs commands and pages, and filters for everything else', () => {
		expect(parseBar('/reveal')).toEqual({ type: 'command', command: 'reveal' });
		expect(parseBar('  /INCOGNITO ')).toEqual({ type: 'command', command: 'incognito' });
		expect(parseBar('/settings watching')).toEqual({
			type: 'page',
			label: 'SETTINGS · WATCHING',
			href: '/settings?section=watching'
		});
		expect(parseBar('/help phone')).toEqual({
			type: 'page',
			label: 'HELP · YOUR PHONE',
			href: '/help/phone'
		});
		expect(parseBar('isekai')).toEqual({ type: 'filter' });
		expect(parseBar('   ')).toEqual({ type: 'filter' });
	});

	it('names an unknown command rather than filtering for it', () => {
		expect(parseBar('/rev')).toEqual({ type: 'unknown', text: '/rev' });
		expect(parseBar('/settingsx')).toEqual({ type: 'unknown', text: '/settingsx' });
	});

	it('agrees with the library parser on every real command', () => {
		for (const raw of [
			'/reveal',
			'/hide',
			'/light',
			'/dark',
			'/incognito',
			'/scan',
			'/lock',
			'/unlock',
			'/words'
		]) {
			expect(parseBar(raw), raw).toEqual(parseSearch(raw));
		}
	});
});
