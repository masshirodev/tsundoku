/**
 * What the focus layer can move to, and what keeps its own arrow keys
 * (doc/FOCUS.md). The DOM half of the layer; the choosing is in geometry.ts.
 */

import type { Direction, Rect } from './geometry';
import { arrowKept, type SliderShape } from './keys';

/**
 * What a D-pad can land on. A tabindex of -1 is deliberately absent: those are
 * programmatic targets (the series cover's finger shortcut), not stops.
 */
const FOCUSABLE = [
	'a[href]',
	'area[href]',
	'button:not([disabled])',
	'input:not([disabled]):not([type="hidden"])',
	'select:not([disabled])',
	'textarea:not([disabled])',
	'summary',
	'[tabindex]:not([tabindex="-1"])'
].join(',');

/** Not a stop: hidden, inert, opted out, or not drawn. */
export function isVisible(el: Element): el is HTMLElement {
	if (!(el instanceof HTMLElement) || !el.isConnected) return false;
	if (el.hidden) return false;
	// `inert` is the browser's own way of saying a subtree takes nothing.
	if (el.closest('[inert], [hidden], [data-focus-off], [data-focus-skip]')) return false;
	// aria-hidden is for assistive tech, but a button behind it is a button a
	// screen reader user can't reach either, so it isn't a stop for the pad.
	if (el.closest('[aria-hidden="true"]')) return false;
	if ((el as HTMLInputElement).disabled) return false;
	// A closed <details> draws nothing focusable inside it, even where its own
	// styles still give the children a box (the filter panel's CLEAR).
	const closed = el.closest('details:not([open])');
	if (closed && !(el.tagName === 'SUMMARY' && el.parentElement === closed)) return false;
	const style = getComputedStyle(el);
	if (style.visibility === 'hidden' || style.display === 'none') return false;
	return el.getClientRects().length > 0;
}

export function isFocusable(el: Element | null): el is HTMLElement {
	return !!el && el.matches(FOCUSABLE) && isVisible(el);
}

/** Every stop inside `root`, in DOM order. */
export function focusablesIn(root: ParentNode): HTMLElement[] {
	return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(isFocusable);
}

export function rectOf(el: Element): Rect {
	const r = el.getBoundingClientRect();
	return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

const shapeOf = (el: Element): SliderShape => ({
	adjust: el.getAttribute('data-focus-adjust'),
	slider: el.getAttribute('role') === 'slider',
	range: el instanceof HTMLInputElement && el.type === 'range',
	orientation: el.getAttribute('aria-orientation')
});

/**
 * Whether the focused thing keeps this arrow for itself, so the layer leaves
 * it alone.
 *
 * A slider first: the nearest `role="slider"`, native range or
 * `[data-focus-adjust]` around the target decides (`arrowKept`, keys.ts): the
 * arrows along its axis are its own and the others leave, on every device.
 *
 * Then a text entry, which is the entry's own: ←/→ keep the caret in a
 * single-line field, while ↑/↓ leave it; a textarea or a contenteditable
 * keeps all four. A `<select>` keeps ←/→ to change its value in place -- a
 * remote has no other key that would -- and lets ↑/↓ leave, or a D-pad would
 * be trapped in it. No screen draws one: the library's SORT is a
 * ChoiceMenu.
 */
export function keepsArrow(target: Element, direction: Direction): boolean {
	const chain: SliderShape[] = [];
	for (let el: Element | null = target; el; el = el.parentElement) chain.push(shapeOf(el));
	const kept = arrowKept(chain, direction);
	if (kept !== null) return kept;
	const entry = target.closest<HTMLElement>(
		'input, textarea, select, [contenteditable]:not([contenteditable="false"])'
	);
	if (!entry) return false;
	const tag = entry.tagName;
	if (tag === 'SELECT') return direction === 'left' || direction === 'right';
	if (tag === 'TEXTAREA' || entry.isContentEditable) return true;
	// A range never gets here: it is a slider, decided above.
	const type = (entry as HTMLInputElement).type;
	return (direction === 'left' || direction === 'right') && type !== 'checkbox' && type !== 'radio';
}
