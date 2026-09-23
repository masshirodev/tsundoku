import { browser } from '$app/environment';
import type { Rating } from '$lib/library/types';
import {
	destinationOf,
	fillOf,
	nextChangeIn,
	phaseAt,
	type Destination,
	type Phase
} from './waiting';

/**
 * The one navigation state every screen shares (doc/WAITING.md). The root
 * layout starts and ends it from SvelteKit's navigation events; the headers
 * draw its line, and the layout draws the outlines and the band.
 */

/** What a tapped tile already knows about the series it opens. */
export type SeriesPreview = {
	id: number;
	title: string;
	kind: string;
	hue: number;
	rating: Rating;
	favourite: boolean;
	hidden: boolean;
	entryCount: number;
	readCount: number;
	cover: number | null;
};

class Waiting {
	/** When the navigation started, or null when nothing is on its way. */
	startedAt = $state<number | null>(null);
	now = $state(0);
	to = $state<Destination>({ kind: 'other' });
	loaded = $state(0);
	total = $state(0);
	/** Set by a tile just before it navigates, for the optimistic series screen. */
	preview = $state<SeriesPreview | null>(null);
	/** A person or tag page's name, from the chip that was tapped. */
	personName = $state<string | null>(null);

	private timer: ReturnType<typeof setTimeout> | undefined;
	private pressed: Element | null = null;

	readonly elapsed = $derived(
		this.startedAt === null ? null : Math.max(0, this.now - this.startedAt)
	);
	readonly phase: Phase = $derived(phaseAt(this.elapsed));
	readonly fill = $derived(fillOf(this.loaded, this.total));

	constructor() {
		if (!browser) return;
		addEventListener('tsundoku:bytes', (e) => {
			const d = (e as CustomEvent<{ loaded: number; total: number }>).detail;
			if (this.startedAt === null) return;
			this.loaded = d.loaded;
			this.total = d.total;
		});
	}

	private tick = () => {
		this.now = Date.now();
		const elapsed = this.elapsed;
		if (elapsed === null) return;
		const next = nextChangeIn(elapsed);
		if (next !== null) this.timer = setTimeout(this.tick, next);
	};

	/** A navigation started: `from` is the element the tap landed on, if any. */
	start(url: URL | null | undefined, routeId: string | null | undefined, from: Element | null) {
		clearTimeout(this.timer);
		this.release();
		this.startedAt = Date.now();
		this.now = this.startedAt;
		this.to = destinationOf(url, routeId);
		this.loaded = 0;
		this.total = 0;
		// The tapped element holds its pressed inversion until the next screen
		// draws: that's how a tap is heard within one frame.
		if (from) {
			from.classList.add('nav-pressed');
			this.pressed = from;
		}
		if (this.to.kind !== 'series' || this.preview?.id !== this.to.id) this.preview = null;
		if (this.to.kind !== 'person') this.personName = null;
		this.tick();
	}

	end() {
		clearTimeout(this.timer);
		this.release();
		this.startedAt = null;
		this.preview = null;
		this.personName = null;
	}

	private release() {
		this.pressed?.classList.remove('nav-pressed');
		this.pressed = null;
	}
}

export const waiting = new Waiting();
