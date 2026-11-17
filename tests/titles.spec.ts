import { describe, expect, it } from 'vitest';
import { titleFromPath } from '$lib/library/titles';

// A source that answers its details with no title (Mangahere; "Love Junkies").
describe('a title from an address', () => {
	it('takes the last part of the path, in words', () => {
		expect(titleFromPath('/manga/love_junkies/')).toBe('Love Junkies');
		expect(titleFromPath('/series/return-of-the-mount-hua-sect?x=1')).toBe(
			'Return Of The Mount Hua Sect'
		);
		expect(titleFromPath('/title/caf%C3%A9-nights.html')).toBe('Café Nights');
		expect(titleFromPath('/')).toBe('Untitled');
		expect(titleFromPath('/a/%E0%A4%A')).toBe('%E0%A4%A');
	});
});
