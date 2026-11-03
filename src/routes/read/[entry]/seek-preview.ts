import type Hls from 'hls.js';

/**
 * A stream's seek preview (doc/ANIME.md, "The player"; card c385). A
 * downloaded episode has a sprite sheet the workstation cut from its file; a
 * stream has none, since making one would mean reading the whole episode. So
 * the player keeps a second, hidden picture on the stream's **lowest**
 * quality, through the same loopback addresses, and seeks it to the time
 * under the pointer: one small segment per stop, drawn to a canvas.
 *
 * It fetches only while the pointer is on the scrubber, never in the
 * background. hls.js would buffer ahead by default, so it is held on a short
 * lead: `autoStartLoad: false` (nothing until the first stop), a buffer goal
 * of one second, no back buffer, and `stopLoad()` as soon as a frame is drawn
 * and when the pointer leaves. A stop that takes longer than
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
			this.manifest = new Promise<void>((ok) => h.once(H.Events.MANIFEST_PARSED, () => ok()));
			h.loadSource(this.quality.src);
			h.attachMedia(this.video);
		} else {
			this.video.src = this.quality.src;
			this.manifest = Promise.resolve();
		}
		return this.manifest;
	}

	/** One stop: the frame at [t] seconds as a picture's address, or null if it was too slow. */
	async frameAt(t: number): Promise<string | null> {
		if (this.dead) return null;
		const work = (async () => {
			await this.open();
			if (this.dead) return null;
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
			// Drawn or given up: nothing more is fetched until the next stop.
			this.stop();
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
		this.hls?.stopLoad();
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
