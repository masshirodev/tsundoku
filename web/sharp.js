// sharp, the native image library, for the web edition's server worker
// (doc/WEB-EDITION.md, "The stand-ins"). A tab cannot load native code, but a
// worker has createImageBitmap and OffscreenCanvas, which do what tsundoku
// asks of sharp for its thumbnails: one chain,
//
//   sharp(input, opts).rotate().resize({...}).webp({ quality }).toBuffer()
//
// (a browse cover, a page thumbnail, an episode still). That chain is
// implemented here; every other call (stats, raw pixels for duplicate
// detection, metadata, files) says it is not in the web edition yet. The
// settings sharp takes while modules load (cache, concurrency) are accepted
// and ignored.
//
// rotate() is sharp's "upright by the EXIF orientation", which
// createImageBitmap already does by default (imageOrientation: 'from-image').
// The encoder is the browser's: WebP in Chromium and Firefox; a browser
// without a WebP encoder hands back PNG, which still shows.

const notYet = (/** @type {string} */ call) => () => {
	throw new Error(`sharp.${call} (image processing) is not in the web edition yet`);
};

/**
 * @typedef {{ width?: number, height?: number, fit?: string, position?: string,
 *   withoutEnlargement?: boolean }} Resize
 * @typedef {{ sx: number, sy: number, sw: number, sh: number, dw: number, dh: number }} Plan
 */

/**
 * Where to cut the source and how big to draw it, as sharp's resize would:
 * one side given keeps the aspect; both with `fit: 'cover'` (sharp's
 * default) fill the box and cut the overflow, from the top for `position:
 * 'top'` and from the centre otherwise; `withoutEnlargement` never grows it.
 * @param {number} w0 @param {number} h0 @param {Resize | undefined} r
 * @returns {Plan}
 */
export function plan(w0, h0, r) {
	const whole = { sx: 0, sy: 0, sw: w0, sh: h0 };
	if (!r || (!r.width && !r.height)) return { ...whole, dw: w0, dh: h0 };
	if (r.width && r.height) {
		if (r.fit && r.fit !== 'cover')
			throw new Error(`sharp resize fit "${r.fit}" is not in the web edition yet`);
		let dw = r.width;
		let dh = r.height;
		if (r.withoutEnlargement && (dw > w0 || dh > h0)) {
			const k = Math.min(w0 / dw, h0 / dh);
			dw = Math.round(dw * k);
			dh = Math.round(dh * k);
		}
		// The largest piece of the source with the box's aspect.
		const k = Math.min(w0 / dw, h0 / dh);
		const sw = Math.min(w0, Math.round(dw * k));
		const sh = Math.min(h0, Math.round(dh * k));
		const sx = Math.round((w0 - sw) / 2);
		const sy = r.position === 'top' ? 0 : Math.round((h0 - sh) / 2);
		return { sx, sy, sw, sh, dw, dh };
	}
	let dw = r.width ?? Math.round((w0 * /** @type {number} */ (r.height)) / h0);
	let dh = r.height ?? Math.round((h0 * /** @type {number} */ (r.width)) / w0);
	if (r.withoutEnlargement && (dw > w0 || dh > h0)) {
		dw = w0;
		dh = h0;
	}
	return { ...whole, dw: Math.max(1, dw), dh: Math.max(1, dh) };
}

/** @param {Uint8Array | ArrayBuffer} input */
function pipeline(input) {
	/** @type {Resize | undefined} */
	let size;
	let quality = 0.8;
	const self = {
		rotate: () => self,
		/** @param {Resize} r */
		resize: (r) => {
			size = r;
			return self;
		},
		/** @param {{ quality?: number }} [o] */
		webp: (o) => {
			quality = (o?.quality ?? 80) / 100;
			return self;
		},
		async toBuffer() {
			const bitmap = await createImageBitmap(new Blob([/** @type {BlobPart} */ (input)]));
			try {
				const p = plan(bitmap.width, bitmap.height, size);
				const canvas = new OffscreenCanvas(p.dw, p.dh);
				const ctx = /** @type {OffscreenCanvasRenderingContext2D} */ (canvas.getContext('2d'));
				ctx.imageSmoothingQuality = 'high';
				ctx.drawImage(bitmap, p.sx, p.sy, p.sw, p.sh, 0, 0, p.dw, p.dh);
				const blob = await canvas.convertToBlob({ type: 'image/webp', quality });
				return Buffer.from(await blob.arrayBuffer());
			} finally {
				bitmap.close();
			}
		},
		stats: notYet('stats'),
		metadata: notYet('metadata'),
		raw: notYet('raw'),
		greyscale: notYet('greyscale'),
		grayscale: notYet('grayscale'),
		extract: notYet('extract'),
		png: notYet('png'),
		jpeg: notYet('jpeg'),
		toFile: notYet('toFile')
	};
	return self;
}

const sharp = Object.assign(
	/** @param {Uint8Array | ArrayBuffer} input */
	(input) => pipeline(input),
	{
		cache: () => ({}),
		concurrency: () => 1,
		simd: () => false,
		counters: () => ({}),
		format: {},
		versions: {}
	}
);
export default sharp;
