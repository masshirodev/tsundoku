import type Hls from 'hls.js';

/**
 * A stream's seek preview (doc/ANIME.md, "The player"). A
 * downloaded episode has a sprite sheet the workstation cut from its file; a
 * stream has none, since making one would mean reading the whole episode. So
 * the player keeps a second, hidden picture on the stream's **lowest**
 * quality, through the same loopback addresses, and seeks it to the time
 * under the pointer: one small segment per stop, drawn to a canvas.
 *
 * It fetches only while the pointer is on the scrubber, never in the
 * background. hls.js would buffer ahead by default, so it is held on a short
 * lead: `autoStartLoad: false` (nothing until the first stop), a buffer goal
 * of one second, no back buffer, and `stopLoad()` as soon as the latest stop's
 * frame is drawn and when the pointer leaves. A stop that takes longer than
 * `PREVIEW_TIMEOUT_MS`, or a source with no quality at or below
 * `PREVIEW_MAX_H`, shows the time alone.
 */

/** A pause on one place before it is fetched: a sweep across the bar asks for nothing. */
export const PREVIEW_DEBOUNCE_MS = 150;
/** A stop that takes longer than this shows the time alone. */
export const PREVIEW_TIMEOUT_MS = 1000;
/** A quality above this is not a preview's: a stop would fetch a full-size segment. */
export const PREVIEW_MAX_H = 480;
/** The frame drawn, as the sprite's tiles are. */
export const PREVIEW_W = 160;
export const PREVIEW_H = 90;

/**
 * How near the time under the pointer a stream's frame must be drawn for to
 * be shown with it: half a percent of the episode, and at least a second.
 * A stop takes the debounce and a segment to answer, and meanwhile the tip
 * shows the time alone rather than another time's picture over it.
 */
export function nearFrame(drawnAt: number | null, at: number, duration: number): boolean {
	if (drawnAt === null) return false;
	const near = Math.max(1, (Number.isFinite(duration) ? duration : 0) * 0.005);
	return Math.abs(at - drawnAt) <= near;
}

export type PreviewQuality = { kind: 'hls' | 'file'; src: string; height: number | null };

/**
 * Which quality a stream's preview reads: the lowest the server offers, if
 * its height is known and at most `PREVIEW_MAX_H`. A quality of unknown
 * height may be the full picture, so it is not guessed at.
 */
export function previewQuality<Q extends PreviewQuality>(qualities: Q[]): Q | null {
	const known = qualities.filter((q) => q.height !== null);
	if (!known.length) return null;
	const low = known.reduce((a, b) => (b.height! < a.height! ? b : a));
	return low.height! <= PREVIEW_MAX_H ? low : null;
}

/** hls.js held to one segment a stop: nothing before the first, nothing ahead. */
export const PREVIEW_HLS_CONFIG = {
	autoStartLoad: false,
	startFragPrefetch: false,
	maxBufferLength: 1,
	maxMaxBufferLength: 1,
	backBufferLength: 0,
	maxBufferSize: 0
} as const;

const once = (el: HTMLMediaElement, type: string) =>
	new Promise<void>((ok) => el.addEventListener(type, () => ok(), { once: true }));

export class StreamPreview {
	private video: HTMLVideoElement;
	private canvas: HTMLCanvasElement;
	private hls: Hls | null = null;
	private manifest: Promise<void> | null = null;
	private dead = false;
	/** The latest stop: an earlier one, answered or given up, must not stop its load. */
	private seq = 0;
	/**
	 * How many times loading was stopped (a frame drawn, a stop given up, the
	 * pointer gone). A stop whose source opened after one of those is over:
	 * it must not start a load nothing would stop.
	 */
	private stopped = 0;
	/**
	 * The playlist is in. Before it, nothing loads but the playlist itself
	 * (`autoStartLoad: false`), and hls.js's `stopLoad()` would destroy that
	 * request in flight: MANIFEST_PARSED would never come and every later stop
	 * would wait on it for good.
	 */
	private parsed = false;

	constructor(
		private quality: PreviewQuality,
		private HlsClass: typeof Hls | null
	) {
		this.video = document.createElement('video');
		this.video.muted = true;
		this.video.playsInline = true;
		this.video.preload = 'none';
		this.canvas = document.createElement('canvas');
		this.canvas.width = PREVIEW_W;
		this.canvas.height = PREVIEW_H;
	}

	/** The first stop opens the source: the playlist for HLS, the address for a file. */
	private open(): Promise<void> {
		if (this.manifest) return this.manifest;
		const H = this.HlsClass;
		if (this.quality.kind === 'hls' && H?.isSupported()) {
			const h = new H({ ...PREVIEW_HLS_CONFIG });
			this.hls = h;
			this.manifest = new Promise<void>((ok, fail) => {
				h.once(H.Events.MANIFEST_PARSED, () => {
					this.parsed = true;
					ok();
				});
				// A playlist that never comes (an error, a hoster's 5xx): this stop
				// gives up, and the next one asks again on a fresh player.
				h.on(H.Events.ERROR, (_e, d) => {
					if (!d.fatal || this.parsed || this.hls !== h) return;
					this.hls = null;
					this.manifest = null;
					h.destroy();
					fail(new Error('preview playlist failed'));
				});
			});
			h.loadSource(this.quality.src);
			h.attachMedia(this.video);
		} else {
			// A plain file: `preload = 'none'` would hold even the seek's own
			// read, so the file is let read its header, and a seek then reads the
			// bytes at the time asked.
			this.video.preload = 'metadata';
			this.video.src = this.quality.src;
			this.parsed = true;
			this.manifest = Promise.resolve();
		}
		return this.manifest;
	}

	/** One stop: the frame at [t] seconds as a picture's address, or null if it was too slow. */
	async frameAt(t: number): Promise<string | null> {
		if (this.dead) return null;
		const mine = ++this.seq;
		const stops = this.stopped;
		const work = (async () => {
			await this.open();
			// A manifest later than the stop's second: the stop gave up, or the
			// pointer left, or a later stop began, while it was on its way.
			if (this.dead || mine !== this.seq || stops !== this.stopped) return null;
			this.hls?.startLoad(t);
			const seeked = once(this.video, 'seeked');
			this.video.currentTime = t;
			await seeked;
			if (this.video.readyState < 2) await once(this.video, 'loadeddata');
			return this.draw();
		})();
		const late = new Promise<null>((ok) => setTimeout(() => ok(null), PREVIEW_TIMEOUT_MS));
		try {
			return await Promise.race([work, late]);
		} catch {
			return null;
		} finally {
			// Drawn or given up: nothing more is fetched until the next stop. Only
			// the latest stop's: an earlier one still waiting when a later one
			// began (a slow engine) would otherwise stop the later one's segment.
			if (mine === this.seq) this.stop();
		}
	}

	private draw(): string | null {
		const ctx = this.canvas.getContext('2d');
		const { videoWidth: w, videoHeight: h } = this.video;
		if (!ctx || !w || !h) return null;
		// Fitted into the tile, letterboxed, as the sprite's frames are.
		const scale = Math.min(PREVIEW_W / w, PREVIEW_H / h);
		const dw = w * scale;
		const dh = h * scale;
		ctx.fillStyle = '#000';
		ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H);
		ctx.drawImage(this.video, (PREVIEW_W - dw) / 2, (PREVIEW_H - dh) / 2, dw, dh);
		return this.canvas.toDataURL('image/jpeg', 0.7);
	}

	/** The pointer left the bar, or a frame is drawn: no more fetching. */
	stop(): void {
		this.stopped++;
		if (this.parsed) this.hls?.stopLoad();
	}

	/**
	 * The pointer left the bar. A playlist's player is held by `stop()`; a
	 * plain file's picture has no such switch, and after a seek the browser
	 * reads on past the frame, so its source is let go: nothing is read off
	 * the bar, and the next stop opens the file again (its header, then the
	 * time asked).
	 */
	leave(): void {
		this.stop();
		if (this.quality.kind === 'hls' && this.hls) return;
		if (!this.manifest) return;
		this.manifest = null;
		this.parsed = false;
		this.video.removeAttribute('src');
		this.video.load();
	}

	/** The episode or its server changed: everything goes. */
	destroy(): void {
		this.dead = true;
		this.hls?.destroy();
		this.hls = null;
		this.video.removeAttribute('src');
		this.video.load();
	}
}
