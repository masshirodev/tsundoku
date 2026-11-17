/**
 * One finger turns a page (doc/READER.md, "Turning pages", and
 * doc/TEXT-READER.md, "Touch"). A reader's press -- a tap, a drag that turns,
 * a long press -- belongs to the pointer that began it. A second pointer going
 * down while it is under way (a pinch's second finger) ends it as the browser's
 * own `pointercancel` would, so the page settles back instead of jerking
 * towards the new finger; and neither pointer's later moves or lifts are the
 * press's any more. Shared by the image and text readers.
 */

/** The parts of a `PointerEvent` the rule reads. */
export type PointerLike = { pointerId: number; isPrimary: boolean };

export class OnePointer {
	#id: number | null = null;

	/**
	 * A pointer went down. `'start'`: it begins a press. That is the primary
	 * pointer, always: a browser makes a pointer primary only when no other of
	 * its type is down, so a press whose lift never reached the reader can't
	 * hold the next one hostage. `'cancel'`: another pointer arrived mid-press,
	 * which is over now; the reader drops it as on `pointercancel`. `'ignore'`:
	 * neither (a second finger after the press was dropped, a third).
	 */
	down(e: PointerLike): 'start' | 'cancel' | 'ignore' {
		if (e.isPrimary) {
			this.#id = e.pointerId;
			return 'start';
		}
		if (this.#id === null) return 'ignore';
		this.#id = null;
		return 'cancel';
	}

	/** This event is the press's own pointer's. */
	owns(e: Pick<PointerLike, 'pointerId'>): boolean {
		return this.#id !== null && e.pointerId === this.#id;
	}

	/** The press is over (lifted or cancelled). */
	end(): void {
		this.#id = null;
	}
}
