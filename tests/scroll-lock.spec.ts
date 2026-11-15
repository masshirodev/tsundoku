import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lockPage, lockPageWhileShown, pageLocks } from '$lib/scroll-lock';

// The page held still under a cover (src/lib/scroll-lock.ts): covers stack, so
// the page is unlocked only when the last one lets go, and gets back what it had.

type Style = { overflow: string; scrollbarGutter: string };
let style: Style;

// A desktop page with a classic 15px scrollbar, unless a case takes it away.
let root: { style: Style; clientWidth: number };
beforeEach(() => {
	style = { overflow: '', scrollbarGutter: '' };
	root = { style, clientWidth: 1425 };
	(globalThis as { document?: unknown }).document = { documentElement: root };
	(globalThis as { window?: unknown }).window = { innerWidth: 1440 };
});
afterEach(() => {
	delete (globalThis as { document?: unknown }).document;
	delete (globalThis as { window?: unknown }).window;
	expect(pageLocks()).toBe(0);
});

describe('lockPage', () => {
	it('locks the page and keeps the scrollbar gutter, and puts both back', () => {
		const release = lockPage();
		expect(style).toEqual({ overflow: 'hidden', scrollbarGutter: 'stable' });
		release();
		expect(style).toEqual({ overflow: '', scrollbarGutter: '' });
	});

	// A page with no scrollbar taking space (short, an overlay bar, a TV) gets
	// no gutter: one added there moved the page and its sheets 10px (c1033).
	it('keeps no gutter where no scrollbar took space', () => {
		root.clientWidth = 1440;
		const release = lockPage();
		expect(style).toEqual({ overflow: 'hidden', scrollbarGutter: '' });
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

// A cover a media query can hide while it stays open (FILTER in the desktop's
// top bar below 1024px, c1033): locked only while it is drawn.
describe('lockPageWhileShown', () => {
	let watchers: { cb: () => void; on: boolean }[];
	beforeEach(() => {
		watchers = [];
		(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
			private w: { cb: () => void; on: boolean };
			constructor(cb: () => void) {
				this.w = { cb, on: false };
				watchers.push(this.w);
			}
			observe() {
				this.w.on = true;
			}
			disconnect() {
				this.w.on = false;
			}
		};
	});
	afterEach(() => {
		delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
	});
	const box = (drawn: { now: boolean }) =>
		({ getClientRects: () => ({ length: drawn.now ? 1 : 0 }) }) as unknown as Element;
	const resized = () => watchers.filter((w) => w.on).forEach((w) => w.cb());

	it('locks while drawn, lets go while hidden, and locks again when drawn again', () => {
		const drawn = { now: true };
		const release = lockPageWhileShown(box(drawn));
		expect(style.overflow).toBe('hidden');
		drawn.now = false;
		resized();
		expect(style.overflow).toBe('');
		expect(pageLocks()).toBe(0);
		drawn.now = true;
		resized();
		expect(style.overflow).toBe('hidden');
		release();
		expect(style.overflow).toBe('');
		expect(watchers.every((w) => !w.on)).toBe(true);
	});

	it('takes no lock for a cover opened hidden, and its release is harmless', () => {
		const release = lockPageWhileShown(box({ now: false }));
		expect(pageLocks()).toBe(0);
		release();
		release();
		expect(pageLocks()).toBe(0);
	});

	it('stacks with a plain lock: the page stays locked under the one still drawn', () => {
		const drawn = { now: true };
		const sheet = lockPage();
		const filter = lockPageWhileShown(box(drawn));
		drawn.now = false;
		resized();
		expect(style.overflow).toBe('hidden');
		sheet();
		expect(style.overflow).toBe('');
		filter();
	});

	it('falls back to a plain lock where there is no ResizeObserver', () => {
		delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
		const release = lockPageWhileShown(box({ now: false }));
		expect(style.overflow).toBe('hidden');
		release();
	});
});
