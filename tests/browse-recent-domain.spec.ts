import { describe, expect, it } from 'vitest';
import {
	FOLDED,
	PREPAINT,
	PREPAINT_ATTR,
	PREPAINT_TAG,
	RECENT_KEY,
	recentFolded,
	recentRight
} from '$lib/library/browse-recent';

/** BROWSE's RECENT fold (card c726; doc/BROWSE.md, "RECENT folds"): the stored word and the label's words. */
describe('the stored word', () => {
	it('folds only on its own word: nothing, junk and the DETAILS fold’s word leave RECENT open', () => {
		expect(recentFolded(FOLDED)).toBe(true);
		for (const v of [null, undefined, '', '1', '0', 'open', 'FOLDED', ' folded'])
			expect(recentFolded(v), String(v)).toBe(false);
	});
	it('is one key of its own, not the series screen’s', () => {
		expect(RECENT_KEY).toBe('tsundoku:browse-recent');
		expect(RECENT_KEY).not.toBe('tsundoku:series-details');
	});
});

describe('the label’s right half', () => {
	it('open: LAST BROWSED and HIDE ↑; folded: how many and SHOW ↓', () => {
		expect(recentRight(false, 4)).toEqual({ text: 'LAST BROWSED', toggle: 'HIDE ↑' });
		for (const n of [1, 2, 3, 4])
			expect(recentRight(true, n)).toEqual({ text: `${n} RECENT`, toggle: 'SHOW ↓' });
	});
});

describe('the pre-paint script', () => {
	/** Run PREPAINT against a stand-in `localStorage` and `<html>`, as the browser's head would. */
	function run(stored: string | null, throws = false) {
		const attrs = new Map<string, string>();
		const localStorage = {
			getItem: (k: string) => {
				if (throws) throw new Error('SecurityError');
				return k === RECENT_KEY ? stored : null;
			}
		};
		const document = {
			documentElement: { setAttribute: (k: string, v: string) => attrs.set(k, v) }
		};
		new Function('localStorage', 'document', PREPAINT)(localStorage, document);
		return attrs;
	}
	it('marks <html> exactly when the device folded RECENT', () => {
		expect(run(FOLDED).has(PREPAINT_ATTR)).toBe(true);
		for (const v of [null, '', '1', 'open'])
			expect(run(v).has(PREPAINT_ATTR), String(v)).toBe(false);
	});
	it('leaves RECENT open when storage throws', () => {
		expect(run(FOLDED, true).size).toBe(0);
	});
	it('can sit in a <script> as it is: no closing tag inside it', () => {
		expect(PREPAINT).not.toMatch(/<\/script/i);
		expect(PREPAINT_TAG).toBe(`<script>${PREPAINT}</script>`);
	});
});
