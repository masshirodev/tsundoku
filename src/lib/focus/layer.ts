/**
 * The focus layer: one key listener for the whole app, arrow keys moving focus
 * by geometry, and a scope per sheet (doc/FOCUS.md).
 *
 * Installed once from the root layout. A screen does not opt in; a screen that
 * already reads the arrows itself (the readers, the player) opts out by putting
 * `data-focus-off` on its root, and a sheet is a scope by putting
 * `use:focusScope` on its own element.
 */

import { directionOf, nextInDirection } from './geometry';
import { focusablesIn, isFocusable, isVisible, keepsArrow, rectOf } from './dom';

type Scope = {
	node: HTMLElement;
	/** What opened it, put back when it closes. */
	restoreTo: HTMLElement | null;
};

const scopes: Scope[] = [];
const SAVED = 'tsundoku.focus';

/** The scope taking keys right now: the innermost open sheet, else the page. */
function activeScope(): HTMLElement {
	while (scopes.length > 0 && !scopes[scopes.length - 1].node.isConnected) scopes.pop();
	return scopes[scopes.length - 1]?.node ?? document.body;
}

function isManagedScope(node: HTMLElement): boolean {
	return node !== document.body;
}

/** Focus without moving the page: the scroll is done in one step after. */
function take(el: HTMLElement): void {
	el.focus({ preventScroll: true });
	reveal(el);
}

/**
 * Keep the focused thing on screen. `nearest` moves the least it can, which in
 * a uniform grid is a whole row; the TV's own header and focus line are the
 * layout's business (c238).
 */
function reveal(el: HTMLElement): void {
	const r = el.getBoundingClientRect();
	const height = window.visualViewport?.height ?? window.innerHeight;
	const width = window.visualViewport?.width ?? window.innerWidth;
	if (r.top >= 0 && r.left >= 0 && r.bottom <= height && r.right <= width) return;
	el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
}

/** Whether any part of it is on screen now. */
function inViewport(el: HTMLElement): boolean {
	const r = el.getBoundingClientRect();
	const height = window.innerHeight;
	const width = window.innerWidth;
	return r.bottom > 0 && r.right > 0 && r.top < height && r.left < width && r.width > 0;
}

/**
 * Where the first arrow lands on a screen, or where a sheet puts focus when it
 * opens: the screen's declared start (`data-focus-start`), else the first stop
 * in the scope, else the top-left one on the page.
 */
function startOf(scope: HTMLElement): HTMLElement | null {
	const declared = [...scope.querySelectorAll<HTMLElement>('[data-focus-start]')].filter(
		isFocusable
	);
	if (declared.length > 0) {
		// A screen can draw its start twice (the series' ▶ in the bar and in its
		// panel); the one on screen wins, or the first if neither is.
		return declared.find(inViewport) ?? declared[0];
	}

	const stops = focusablesIn(scope);
	if (stops.length === 0) return null;
	if (isManagedScope(scope)) return stops[0];

	// The page: top-left reads as "the beginning" on any of the screens, and a
	// screen whose start matters says so with data-focus-start.
	return stops.reduce((best, el) => {
		const a = rectOf(el);
		const b = rectOf(best);
		if (Math.abs(a.top - b.top) > 4) return a.top < b.top ? el : best;
		return a.left < b.left ? el : best;
	});
}

function move(el: HTMLElement): void {
	take(el);
}

function trapTab(e: KeyboardEvent, scope: HTMLElement): void {
	const stops = focusablesIn(scope);
	if (stops.length === 0) return;
	const current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	const at = current ? stops.indexOf(current) : -1;
	const next =
		at === -1 ? stops[0] : stops[(at + (e.shiftKey ? stops.length - 1 : 1)) % stops.length];
	e.preventDefault();
	e.stopPropagation();
	move(next);
}

function handleKeydown(e: KeyboardEvent): void {
	if (e.defaultPrevented || e.isComposing) return;
	if (e.altKey || e.ctrlKey || e.metaKey) return;

	const target = e.target instanceof Element ? e.target : null;
	// A screen that reads its own keys (the readers, the player while its
	// controls are hidden) keeps them, sheets included.
	if (target?.closest('[data-focus-off]')) return;

	const scope = activeScope();

	if (e.key === 'Tab') {
		if (isManagedScope(scope)) trapTab(e, scope);
		return;
	}

	const direction = directionOf(e.key);

	if (!direction) {
		// With a sheet open, the screen under the scrim takes no keys: a press
		// that would act under it moves focus into the sheet instead.
		if (isManagedScope(scope) && (e.key === 'Enter' || e.key === ' ')) {
			const current = document.activeElement;
			if (!(current instanceof Node) || !scope.contains(current)) {
				const first = startOf(scope);
				if (first) {
					e.preventDefault();
					e.stopPropagation();
					move(first);
				}
			}
		}
		return;
	}

	if (target && keepsArrow(target, direction)) return;

	const current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	if (!current || current === document.body || !isFocusable(current) || !scope.contains(current)) {
		// Nothing focused yet: the first arrow puts focus on the screen's start
		// and does not also move it.
		const start = startOf(scope);
		if (start) {
			e.preventDefault();
			e.stopPropagation();
			move(start);
		}
		return;
	}

	const candidates = focusablesIn(scope).filter((el) => el !== current);
	const next = nextInDirection(
		rectOf(current),
		direction,
		candidates.map((el) => ({ rect: rectOf(el), value: el }))
	);

	// The arrows belong to the pad everywhere else: they never scroll the page.
	e.preventDefault();
	e.stopPropagation();
	if (next) move(next);
}

/**
 * Install the listener. Returns the uninstaller, which the root layout's
 * onMount hands back.
 */
export function installFocusLayer(): () => void {
	if (typeof window === 'undefined') return () => undefined;

	const keydown = (e: KeyboardEvent) => handleKeydown(e);
	window.addEventListener('keydown', keydown, true);
	return () => window.removeEventListener('keydown', keydown, true);
}

/**
 * A sheet's scope: `use:focusScope`. It traps Tab and the arrows, starts on
 * its first row, and puts focus back where it was when it closes. A sheet
 * inside an opted-out screen (a reader's READING panel) does nothing: that
 * screen owns its keys.
 */
export function focusScope(node: HTMLElement): { destroy(): void } {
	if (node.closest('[data-focus-off]')) return { destroy: () => undefined };

	const opener =
		document.activeElement instanceof HTMLElement &&
		document.activeElement !== document.body &&
		!node.contains(document.activeElement)
			? document.activeElement
			: null;
	scopes.push({ node, restoreTo: opener });

	// The rows exist by the time the action runs, but the browser has not laid
	// them out in the same task: focus on the next frame so a rect is real.
	const frame = requestAnimationFrame(() => {
		if (!scopes.some((s) => s.node === node)) return;
		const first = startOf(node);
		if (first) take(first);
	});

	return {
		destroy() {
			cancelAnimationFrame(frame);
			const at = scopes.findIndex((s) => s.node === node);
			if (at === -1) return;
			const entry = scopes[at];
			scopes.splice(at, 1);
			const back = entry.restoreTo;
			if (back && back.isConnected && isVisible(back)) take(back);
			else if (isManagedScope(activeScope())) {
				const first = startOf(activeScope());
				if (first) take(first);
			}
		}
	};
}

// ---- focus across history ----------------------------------------------------

function load(): Record<string, string> {
	try {
		return JSON.parse(sessionStorage.getItem(SAVED) ?? '{}') as Record<string, string>;
	} catch {
		return {};
	}
}

function store(map: Record<string, string>): void {
	try {
		sessionStorage.setItem(SAVED, JSON.stringify(map));
	} catch {
		// Private mode or full: focus then simply is not restored.
	}
}

function keyOf(pathname: string, search: string): string {
	return pathname + search;
}

/**
 * Note the focused thing's name before the screen is left, so a return to this
 * URL can put focus back on it. Called from the root layout's beforeNavigate
 * with the URL the screen belongs to: on a popstate the browser has already
 * changed `location`, while the DOM is still the screen being left.
 */
export function saveFocus(url: URL | null): void {
	const active = document.activeElement;
	const host = active instanceof Element ? active.closest<HTMLElement>('[data-focus-id]') : null;
	const id = host?.dataset.focusId;
	if (!id || !isVisible(host)) return;
	const target = url ?? new URL(location.href);
	const map = load();
	map[keyOf(target.pathname, target.search)] = id;
	store(map);
}

/**
 * Put focus back on the thing this URL was left from (doc/NAVIGATION.md's back
 * paths). The grid arrives a page at a time after the screen does, and a page
 * that arrives can redraw the tiles under it, so the element is put back for a
 * short while rather than once; the reader's first key or tap ends it.
 */
export function restoreFocus(pathname: string, search: string): void {
	const id = load()[keyOf(pathname, search)];
	if (!id) return;

	let frame = 0;
	let frames = 0;
	let done = false;

	const stop = () => {
		done = true;
		cancelAnimationFrame(frame);
		window.removeEventListener('keydown', stop, true);
		window.removeEventListener('pointerdown', stop, true);
	};
	const tick = () => {
		if (done) return;
		if (++frames > 180) return stop();
		const found = [
			...document.querySelectorAll<HTMLElement>(`[data-focus-id="${CSS.escape(id)}"]`)
		].find(isVisible);
		if (found && document.activeElement !== found) take(found);
		frame = requestAnimationFrame(tick);
	};

	window.addEventListener('keydown', stop, true);
	window.addEventListener('pointerdown', stop, true);
	frame = requestAnimationFrame(tick);
}
