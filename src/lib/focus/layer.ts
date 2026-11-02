/**
 * The focus layer: one key listener for the whole app, arrow keys moving focus
 * by geometry, and a scope per sheet (doc/FOCUS.md).
 *
 * Installed once from the root layout. A screen does not opt in; a screen that
 * already reads the arrows itself (the readers, the player's picture) opts out
 * by putting `data-focus-off` on its root, and a sheet is a scope by putting
 * `use:focusScope` on its own element.
 *
 * The remote's own three verbs are here too (doc/TV.md, c235): OK held or MENU
 * opens the focused thing's long-press options through the same `contextmenu`
 * its pointer path listens for, and BACK closes what is open, then climbs, then
 * leaves -- `window.tsundokuBack()` for the app, which a WebView hands BACK to
 * rather than to the page.
 */

import { directionOf, nextInDirection } from './geometry';
import { focusablesIn, isFocusable, isVisible, keepsArrow, rectOf } from './dom';
import { isBackKey, isOkKey, isOptionsKey, OkPress } from './keys';

type Scope = {
	node: HTMLElement;
	/** What opened it, put back when it closes. */
	restoreTo: HTMLElement | null;
	/** A dialog inside a screen that reads its own keys (a reader's page menu). */
	force: boolean;
};

declare global {
	interface Window {
		/** BACK in the page, for the Android app (doc/TV.md, c236's contract). */
		tsundokuBack?: () => boolean;
	}
}

const scopes: Scope[] = [];
const SAVED = 'tsundoku.focus';

/** The scope taking keys right now: the innermost open sheet, else the page. */
function activeScope(): HTMLElement {
	pruneScopes();
	return scopes[scopes.length - 1]?.node ?? document.body;
}

function pruneScopes(): void {
	while (scopes.length > 0 && !scopes[scopes.length - 1].node.isConnected) scopes.pop();
}

/**
 * A dialog that takes the keys even inside a screen that opted out: a reader's
 * page menu sits over a page whose arrows turn pages, and the menu is the one
 * thing the pad must reach while it is open.
 */
function forcedScope(): boolean {
	pruneScopes();
	return scopes[scopes.length - 1]?.force ?? false;
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

// ---- the remote's options: OK held, and MENU ---------------------------------

/**
 * A screen that is open inside the page but is not a focus scope (a reader's
 * chrome, the player's bar and its settings panel) says how BACK gets out of
 * it, in order. The step returns true when it took the key.
 */
export type BackStep = () => boolean;

const backSteps: BackStep[] = [];

export function registerBack(step: BackStep): () => void {
	backSteps.push(step);
	return () => {
		const at = backSteps.lastIndexOf(step);
		if (at !== -1) backSteps.splice(at, 1);
	};
}

/** The long-press sheet's pointer path, fired from a key: one event, one path. */
function openOptions(el: HTMLElement): boolean {
	const event = new MouseEvent('contextmenu', {
		bubbles: true,
		cancelable: true,
		view: window
	});
	// A handler that opened a sheet calls preventDefault, so this says whether
	// the thing had options at all.
	return !el.dispatchEvent(event);
}

let okTarget: HTMLElement | null = null;
let replaying = false;

const okPress = new OkPress(
	() => {
		// A thing with options opens its sheet; a plain button has none, so a
		// hold that no handler took is still the press it was.
		if (okTarget && !openOptions(okTarget)) okTarget.click();
	},
	() => {
		okTarget?.click();
	}
);

/** A text entry owns Enter (a search box, the go-to field). */
function inTextEntry(el: Element | null): boolean {
	return !!el?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
}

/**
 * Let the open sheet close itself: every panel in the app closes on Escape,
 * and some of them are not focus scopes (the reader's, the player's). Dispatching
 * it at the scope keeps one path, and the guard keeps it from coming back here.
 */
function sendEscape(node: HTMLElement): void {
	replaying = true;
	try {
		node.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
		);
	} finally {
		replaying = false;
	}
}

/**
 * BACK climbs before it leaves (TV Calls, "BACK climbs before it leaves"): to
 * the shelf's tab from a grid (its container names the target), else to the
 * screen's own start, else nowhere and the screen is left.
 */
function climb(): boolean {
	const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	if (!active || active === document.body || !isFocusable(active)) return false;

	const group = active.closest<HTMLElement>('[data-back-climb]');
	const selector = group?.dataset.backClimb;
	if (selector) {
		const to = [...document.querySelectorAll<HTMLElement>(selector)].find(isFocusable);
		if (to && to !== active) {
			take(to);
			return true;
		}
	}

	const declared = [...document.querySelectorAll<HTMLElement>('[data-focus-start]')].filter(
		isFocusable
	);
	const start = declared.find(inViewport) ?? declared[0] ?? startOf(document.body);
	if (start && start !== active) {
		take(start);
		return true;
	}
	return false;
}

/**
 * BACK: the open sheet or panel first, then the climb, then nothing -- which
 * is the app's to take (`window.tsundokuBack`). Exported for that contract.
 */
export function back(): boolean {
	for (let i = backSteps.length - 1; i >= 0; i--) {
		if (backSteps[i]()) return true;
	}
	const scope = activeScope();
	if (isManagedScope(scope)) {
		sendEscape(scope);
		return true;
	}
	// A dialog that is not a scope closes on Escape itself (the update notice,
	// the new-shelf sheet, a lightbox): BACK is not the climb's to take from it,
	// so it gets the Escape the sheet would have had.
	const dialog = [...document.querySelectorAll<HTMLElement>('dialog[open], [role="dialog"]')].find(
		isVisible
	);
	if (dialog) {
		sendEscape(dialog);
		return true;
	}
	return climb();
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
	if (e.defaultPrevented || e.isComposing || replaying) return;
	if (e.altKey || e.ctrlKey || e.metaKey) return;

	const target = e.target instanceof Element ? e.target : null;

	// BACK is the whole app's, even inside a screen that reads the other keys
	// itself: closing its panel is how a reader or the player gets out. A text
	// entry keeps Escape (a search field, the go-to row).
	if (isBackKey(e.key) && !inTextEntry(document.activeElement)) {
		if (back()) {
			e.preventDefault();
			e.stopPropagation();
		} else if (e.key !== 'Escape') {
			// The browser's own back button: it means the screen is left.
			e.preventDefault();
			window.history.back();
		}
		return;
	}

	// ▶❚❚ on a remote resumes the focused CONTINUE card there and then, without
	// the series screen (TV Calls, "the remote"). Everywhere else the key is
	// the player's own.
	if (e.key === 'MediaPlayPause') {
		const el = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const card = el?.closest<HTMLElement>('[data-focus-id^="continue-"]');
		if (card) {
			e.preventDefault();
			e.stopPropagation();
			card.click();
		}
		return;
	}

	// A screen that reads its own keys (the readers, the player while its
	// controls are hidden) keeps them, sheets included -- unless the sheet is a
	// dialog that forced the pad in (a reader's page menu).
	if (target?.closest('[data-focus-off]') && !forcedScope()) return;

	const scope = activeScope();

	if (isOkKey(e.key)) {
		// With a sheet open, the screen under the scrim takes no keys: OK on it
		// moves focus into the sheet instead.
		if (isManagedScope(scope)) {
			const current = document.activeElement;
			if (!(current instanceof Node) || !scope.contains(current)) {
				const first = startOf(scope);
				if (first) {
					e.preventDefault();
					e.stopPropagation();
					move(first);
				}
				return;
			}
		}
		const el = document.activeElement;
		if (!(el instanceof HTMLElement) || el === document.body) return;
		if (inTextEntry(el)) return;
		e.preventDefault();
		e.stopPropagation();
		if (e.repeat) return;
		okTarget = el;
		okPress.down(false);
		return;
	}

	if (isOptionsKey(e.key)) {
		const el = document.activeElement;
		if (!(el instanceof HTMLElement) || el === document.body) return;
		e.preventDefault();
		e.stopPropagation();
		openOptions(el);
		return;
	}

	if (e.key === 'Tab') {
		if (isManagedScope(scope)) trapTab(e, scope);
		return;
	}

	// Space under a scrim is the same press as OK: it moves into the sheet
	// rather than acting on the screen behind it.
	if (e.key === ' ' && isManagedScope(scope)) {
		const current = document.activeElement;
		if (!(current instanceof Node) || !scope.contains(current)) {
			const first = startOf(scope);
			if (first) {
				e.preventDefault();
				e.stopPropagation();
				move(first);
			}
			return;
		}
	}

	const direction = directionOf(e.key);

	if (!direction) return;

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

	// Nothing that way: leave the key to the browser, so a desktop keyboard
	// still scrolls prose (HELP, a series' ABOUT) past the last stop. In a
	// sheet the key stays inside, as the scope promises.
	if (!next) {
		if (isManagedScope(scope)) {
			e.preventDefault();
			e.stopPropagation();
		}
		return;
	}

	e.preventDefault();
	e.stopPropagation();
	move(next);
}

/**
 * How the reader last moved: a key or a pointer. Focus is carried across a
 * back only for the keyboard (a remote, a desktop keyboard). On a tablet a tap
 * also focuses the tile it pressed, and putting that back would scroll the
 * page against NAVIGATION.md's own restore.
 */
let lastInput: 'key' | 'pointer' = 'pointer';
function noteKey(): void {
	lastInput = 'key';
}
function notePointer(): void {
	lastInput = 'pointer';
}

/**
 * Install the listener. Returns the uninstaller, which the root layout's
 * onMount hands back.
 */
export function installFocusLayer(): () => void {
	if (typeof window === 'undefined') return () => undefined;

	const keydown = (e: KeyboardEvent) => {
		noteKey();
		handleKeydown(e);
	};

	// The release is what clicks: OK held must not click on its way up (keys.ts).
	const keyup = (e: KeyboardEvent) => {
		if (!isOkKey(e.key) || !okTarget) return;
		e.preventDefault();
		e.stopPropagation();
		const target = okTarget;
		if (target !== document.activeElement && target.isConnected) {
			// Focus moved while it was held: the hold opened something else's
			// sheet, so there is nothing left to press.
			okTarget = null;
			okPress.cancel();
			return;
		}
		// `up` clicks through okTarget, so it is cleared after, not before.
		okPress.up();
		okTarget = null;
	};

	const blur = () => {
		okTarget = null;
		okPress.cancel();
	};

	window.addEventListener('keydown', keydown, true);
	window.addEventListener('keyup', keyup, true);
	window.addEventListener('pointerdown', notePointer, true);
	window.addEventListener('blur', blur);
	// A WebView hands BACK to the app, not the page (doc/TV.md, c236's contract).
	window.tsundokuBack = back;
	return () => {
		window.removeEventListener('keydown', keydown, true);
		window.removeEventListener('keyup', keyup, true);
		window.removeEventListener('pointerdown', notePointer, true);
		window.removeEventListener('blur', blur);
		delete window.tsundokuBack;
	};
}

/**
 * A sheet's scope: `use:focusScope`. It traps Tab and the arrows, starts on
 * its first row, and puts focus back where it was when it closes. A sheet
 * inside an opted-out screen (a reader's READING panel) does nothing: that
 * screen owns its keys, unless the sheet says `force` -- a dialog the pad has
 * to reach even over a page that reads its own arrows.
 */
export function focusScope(
	node: HTMLElement,
	options: { force?: boolean } = {}
): { destroy(): void } {
	if (!options.force && node.closest('[data-focus-off]')) return { destroy: () => undefined };

	const opener =
		document.activeElement instanceof HTMLElement &&
		document.activeElement !== document.body &&
		!node.contains(document.activeElement)
			? document.activeElement
			: null;
	scopes.push({ node, restoreTo: opener, force: !!options.force });

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
	const target = url ?? new URL(location.href);
	const map = load();
	const key = keyOf(target.pathname, target.search);
	if (lastInput !== 'key') {
		// Left by touch or mouse: forget an older keyboard visit's tile, so a
		// back doesn't put focus somewhere the reader never was.
		if (key in map) {
			delete map[key];
			store(map);
		}
		return;
	}
	const active = document.activeElement;
	const host = active instanceof Element ? active.closest<HTMLElement>('[data-focus-id]') : null;
	const id = host?.dataset.focusId;
	if (!id || !isVisible(host)) return;
	map[key] = id;
	store(map);
}

/**
 * Put focus back on the thing this URL was left from (doc/NAVIGATION.md's back
 * paths). The grid arrives a page at a time after the screen does, and a page
 * that arrives can redraw the tiles under it, so the element is put back for a
 * short while rather than once; the reader's first key or tap ends it.
 */
const STOPS = ['keydown', 'pointerdown', 'wheel', 'touchstart'] as const;

export function restoreFocus(pathname: string, search: string): void {
	const id = load()[keyOf(pathname, search)];
	if (!id) return;

	let frame = 0;
	let frames = 0;
	let done = false;

	const stop = () => {
		done = true;
		cancelAnimationFrame(frame);
		for (const type of STOPS) window.removeEventListener(type, stop, true);
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

	// Anything the reader does ends it, a wheel or a finger's scroll included:
	// otherwise each frame's reveal() pulls the page back to the tile.
	for (const type of STOPS) window.addEventListener(type, stop, { capture: true, passive: true });
	frame = requestAnimationFrame(tick);
}
