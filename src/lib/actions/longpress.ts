import type { Action } from 'svelte/action';

/**
 * A long press (450ms without moving more than 10px, or a right-click) calls
 * `onlong` and swallows the click that follows it, so a link held down opens
 * its menu instead of navigating. The same timing as CoverTile and BookTile.
 */
export const longpress: Action<HTMLElement, () => void> = (node, onlong) => {
	const HOLD_MS = 450;
	const SLOP_PX = 10;
	let callback = onlong;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let start: { x: number; y: number } | null = null;
	let fired = false;
	/**
	 * The menu came from a pointer. Only then is a click on its heels the
	 * release's own, to swallow: MENU and a held OK send no click at all, and
	 * swallowing the next one would eat the press that follows.
	 */
	let fromPointer = false;

	const cancel = () => {
		if (timer) clearTimeout(timer);
		timer = null;
		start = null;
	};
	const down = (e: PointerEvent) => {
		fired = false;
		fromPointer = true;
		if (e.button !== 0) return;
		start = { x: e.clientX, y: e.clientY };
		timer = setTimeout(() => {
			timer = null;
			fired = true;
			callback?.();
		}, HOLD_MS);
	};
	const move = (e: PointerEvent) => {
		if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > SLOP_PX) cancel();
	};
	const click = (e: MouseEvent) => {
		cancel();
		if (fired) {
			fired = false;
			e.preventDefault();
			e.stopImmediatePropagation();
		}
	};
	const menu = (e: MouseEvent) => {
		e.preventDefault();
		cancel();
		if (!fired) callback?.();
		fired = fired || fromPointer;
		fromPointer = false;
	};

	node.addEventListener('pointerdown', down);
	node.addEventListener('pointermove', move);
	node.addEventListener('pointerup', cancel);
	node.addEventListener('pointercancel', cancel);
	node.addEventListener('click', click, true);
	node.addEventListener('contextmenu', menu);
	return {
		update(next) {
			callback = next;
		},
		destroy() {
			cancel();
			node.removeEventListener('pointerdown', down);
			node.removeEventListener('pointermove', move);
			node.removeEventListener('pointerup', cancel);
			node.removeEventListener('pointercancel', cancel);
			node.removeEventListener('click', click, true);
			node.removeEventListener('contextmenu', menu);
		}
	};
};
