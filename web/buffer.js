// Node's Buffer for the web edition's server worker (doc/WEB-EDITION.md,
// "The stand-ins"): the `buffer` package, taught the one encoding it lacks.
//
// The package (v6) knows 'base64' but not 'base64url', which Node has had
// since 15 and the server code uses for ids, tokens and digests: a novel's
// id, a cookie's MAC, an OAuth state. Without it those throw "Unknown
// encoding: base64url" (found browsing a source, 2026-11-26).
//
// base64url is base64 with '-' and '_' for '+' and '/', and no padding. The
// package's base64 decoder already reads '-' and '_' and pads what it is
// given, so decoding is base64's; encoding is base64's, then swapped and
// trimmed. Every call that takes an encoding gets 'base64' in its place.
import bufferPackage from 'buffer/index.js';

// The package's own types lag its exports; these are Node's names.
/** @type {any} */
const pkg = bufferPackage;
/** @type {any} */
const B = pkg.Buffer;
const { SlowBuffer, INSPECT_MAX_BYTES, kMaxLength } = pkg;

/** @param {unknown} e */
const isUrl = (e) => typeof e === 'string' && e.toLowerCase() === 'base64url';

/** @param {unknown[]} args */
const swap = (args) => args.map((a) => (isUrl(a) ? 'base64' : a));

/** @param {string} b64 */
const toUrl = (b64) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

if (!B.isEncoding('base64url')) {
	const isEncoding = B.isEncoding;
	B.isEncoding = (/** @type {unknown} */ e) => isUrl(e) || isEncoding(e);

	// Static calls whose encoding argument may be 'base64url'.
	for (const name of /** @type {const} */ (['from', 'alloc', 'byteLength'])) {
		const real = /** @type {(...a: unknown[]) => unknown} */ (B[name]);
		Object.defineProperty(B, name, {
			value: /** @param {unknown[]} args */ function (...args) {
				return real.apply(this, swap(args));
			},
			writable: true,
			configurable: true
		});
	}

	// Instance calls that read or write a string in an encoding.
	/** @type {any} */
	const proto = B.prototype;
	for (const name of ['write', 'fill', 'indexOf', 'lastIndexOf', 'includes']) {
		const real = proto[name];
		/** @param {unknown[]} args */
		proto[name] = function (...args) {
			return real.apply(this, swap(args));
		};
	}

	const toString = proto.toString;
	/** @param {unknown[]} args */
	proto.toString = function (...args) {
		if (!isUrl(args[0])) return toString.apply(this, args);
		return toUrl(/** @type {string} */ (toString.call(this, 'base64', args[1], args[2])));
	};
}

/** Node's Buffer, with base64url. @type {typeof globalThis.Buffer} */
const Buffer = B;

export { Buffer, SlowBuffer, INSPECT_MAX_BYTES, kMaxLength };
export default pkg;
