/**
 * An image's size from its first bytes, without decoding it: JPEG, PNG,
 * WebP (lossy, lossless, extended) and GIF, which is everything the samples
 * hold. The reader lays pages out before they load -- a vertical strip needs
 * every page's height, and spreads need to know which pages are wide -- so
 * the manifest carries sizes, read from 64 KiB of each page. Null when the
 * header can't be read; the reader then assumes a portrait page.
 */
export function imageSize(b: Uint8Array): { w: number; h: number } | null {
	const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
	const at = (i: number) => (i < b.length ? b[i] : 0);
	// PNG: IHDR is always first.
	if (b.length >= 24 && at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) {
		return { w: v.getUint32(16), h: v.getUint32(20) };
	}
	// GIF
	if (b.length >= 10 && at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46) {
		return { w: v.getUint16(6, true), h: v.getUint16(8, true) };
	}
	// WebP: RIFF....WEBP then VP8 / VP8L / VP8X
	if (
		b.length >= 30 &&
		at(0) === 0x52 &&
		at(8) === 0x57 &&
		at(9) === 0x45 &&
		at(10) === 0x42 &&
		at(11) === 0x50
	) {
		const kind = String.fromCharCode(at(12), at(13), at(14), at(15));
		if (kind === 'VP8 ')
			return { w: v.getUint16(26, true) & 0x3fff, h: v.getUint16(28, true) & 0x3fff };
		if (kind === 'VP8L') {
			const bits = v.getUint32(21, true);
			return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
		}
		if (kind === 'VP8X') {
			const w = 1 + (at(24) | (at(25) << 8) | (at(26) << 16));
			const h = 1 + (at(27) | (at(28) << 8) | (at(29) << 16));
			return { w, h };
		}
		return null;
	}
	// JPEG: walk the markers to the first start-of-frame.
	if (at(0) === 0xff && at(1) === 0xd8) {
		let i = 2;
		while (i + 9 < b.length) {
			if (at(i) !== 0xff) {
				i += 1;
				continue;
			}
			const marker = at(i + 1);
			if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
				i += 2;
				continue;
			}
			const len = v.getUint16(i + 2);
			const sof =
				marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
			if (sof) return { w: v.getUint16(i + 7), h: v.getUint16(i + 5) };
			i += 2 + len;
		}
	}
	return null;
}

export function imageType(name: string): string {
	const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
	return (
		{
			jpg: 'image/jpeg',
			jpeg: 'image/jpeg',
			png: 'image/png',
			webp: 'image/webp',
			gif: 'image/gif',
			avif: 'image/avif',
			jxl: 'image/jxl'
		}[ext ?? ''] ?? 'application/octet-stream'
	);
}
