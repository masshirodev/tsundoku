import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lockPage, pageLocks } from '$lib/scroll-lock';

// The page held still under a cover (src/lib/scroll-lock.ts): covers stack, so
// the page is unlocked only when the last one lets go, and gets back what it had.

type Style = { overflow: string; scrollbarGutter: string };
let style: Style;

beforeEach(() => {
	style = { overflow: '', scrollbarGutter: '' };
	(globalThis as { document?: unknown }).document = { documentElement: { style } };
});
afterEach(() => {
	delete (globalThis as { document?: unknown }).document;
	expect(pageLocks()).toBe(0);
});

describe('lockPage', () => {
	it('locks the page and keeps the scrollbar gutter, and puts both back', () => {
		const release = lockPage();
		expect(style).toEqual({ overflow: 'hidden', scrollbarGutter: 'stable' });
		release();
		expect(style).toEqual({ overflow: '', scrollbarGutter: '' });
	});

	it('stays locked until the last of two covers lets go, in either order', () => {
		const reader = lockPage();
		const sheet = lockPage();
		reader();
		expect(style.overflow).toBe('hidden');
		sheet();
		expect(style.overflow).toBe('');
	});

	it('counts a release called twice once', () => {
		const a = lockPage();
		const b = lockPage();
		a();
		a();
		expect(style.overflow).toBe('hidden');
		b();
		expect(style.overflow).toBe('');
	});

	it('gives back what the page had before the first lock', () => {
		style.overflow = 'clip';
		const release = lockPage();
		release();
		expect(style.overflow).toBe('clip');
	});

	it('does nothing on the server', () => {
		delete (globalThis as { document?: unknown }).document;
		const release = lockPage();
		expect(pageLocks()).toBe(0);
		release();
	});
});
