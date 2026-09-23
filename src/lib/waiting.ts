/**
 * Waiting (Loading States; doc/WAITING.md): what the time since a tap says
 * to draw. Pure, so the thresholds are tested without a browser.
 *
 * - under 150 ms only the pressed element shows, so a fast answer never
 *   flashes anything;
 * - from 150 ms the header's rule becomes the progress line;
 * - from 1 s the next screen is drawn in outline;
 * - from 10 s a band says the workstation isn't answering, while the request
 *   carries on.
 */
export type Phase = 'idle' | 'pressed' | 'line' | 'outline' | 'stalled';

export const LINE_MS = 150;
export const OUTLINE_MS = 1000;
export const STALLED_MS = 10_000;

export function phaseAt(elapsed: number | null): Phase {
	if (elapsed === null) return 'idle';
	if (elapsed >= STALLED_MS) return 'stalled';
	if (elapsed >= OUTLINE_MS) return 'outline';
	if (elapsed >= LINE_MS) return 'line';
	return 'pressed';
}

/** When the phase will next change, so one timer covers the whole wait. */
export function nextChangeIn(elapsed: number): number | null {
	for (const at of [LINE_MS, OUTLINE_MS, STALLED_MS]) if (elapsed < at) return at - elapsed;
	return 1000; // Stalled: once a second, for "ASKED 12 S AGO".
}

/**
 * The line's accent fill: bytes arrived over the response's length, in steps
 * with no easing. Nothing is faked: without a length, or before the first
 * byte, it doesn't move.
 */
export function fillOf(loaded: number, total: number): number {
	if (total <= 0 || loaded <= 0) return 0;
	return Math.min(1, loaded / total);
}

/** Where a navigation is going, as far as waiting cares. */
export type Destination =
	| { kind: 'library' }
	| { kind: 'series'; id: number }
	| { kind: 'person'; tag: string }
	| { kind: 'history' }
	| { kind: 'search' }
	| { kind: 'other' };

export function destinationOf(
	url: URL | null | undefined,
	routeId: string | null | undefined
): Destination {
	if (!url) return { kind: 'other' };
	if (routeId === '/series/[id]') return { kind: 'series', id: Number(url.pathname.split('/')[2]) };
	if (routeId === '/history') return { kind: 'history' };
	if (routeId === '/search') return { kind: 'search' };
	if (routeId === '/') {
		const tag = url.searchParams.get('tag');
		return tag ? { kind: 'person', tag } : { kind: 'library' };
	}
	return { kind: 'other' };
}

/** "ASKED 12 S AGO · STILL ASKING". */
export const askedLine = (elapsed: number) =>
	`ASKED ${Math.floor(elapsed / 1000)} S AGO · STILL ASKING`;
