// Bodies between the content script and the background.
//
// Firefox passes runtime messages by structured clone, so a Uint8Array
// arrives as one. Chromium serialises them as JSON, where it arrives as an
// object of numbered keys, so bytes cross as base64 there. Which one a browser
// does is not assumed from its name: the content script sends a probe of
// bytes on start and keeps whichever form came back intact (relay.ts).

export type Transport = 'binary' | 'base64';

export type WireBody = { binary: Uint8Array } | { base64: string };

/** Bytes that survived a crossing, which may have been from another realm. */
export function isBytes(value: unknown): value is Uint8Array {
	return (
		value instanceof Uint8Array || Object.prototype.toString.call(value) === '[object Uint8Array]'
	);
}

export function encodeBody(bytes: Uint8Array, transport: Transport): WireBody {
	return transport === 'binary' ? { binary: bytes } : { base64: toBase64(bytes) };
}

export function decodeBody(body: WireBody | null | undefined): Uint8Array<ArrayBuffer> {
	if (!body) return new Uint8Array(0);
	if ('binary' in body) {
		if (!isBytes(body.binary)) throw new Error('a binary body arrived as something else');
		// A cloned array is always over a plain ArrayBuffer, never a shared one.
		return body.binary as Uint8Array<ArrayBuffer>;
	}
	return fromBase64(body.base64);
}

/** The probe's bytes: every value a byte can take, so nothing is lost unseen. */
export function probeBytes(): Uint8Array {
	return Uint8Array.from({ length: 256 }, (_, i) => i);
}

/** Whether a probe came back as the bytes that were sent. */
export function probeSurvived(value: unknown): boolean {
	if (!isBytes(value) || value.length !== 256) return false;
	return value.every((byte, i) => byte === i);
}

export function toBase64(bytes: Uint8Array): string {
	let text = '';
	// In chunks: String.fromCharCode takes its bytes as arguments, and an
	// image's worth of arguments overflows the stack.
	for (let i = 0; i < bytes.length; i += 0x8000) {
		text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return btoa(text);
}

export function fromBase64(base64: string): Uint8Array<ArrayBuffer> {
	const text = atob(base64);
	const bytes = new Uint8Array(text.length);
	for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
	return bytes;
}
