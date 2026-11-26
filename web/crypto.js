// The web edition's `node:crypto` (doc/WEB-EDITION.md, "Crypto"): the calls the
// server code makes, synchronous as Node's are. A browser's WebCrypto is
// asynchronous, and the server code hashes inline (an extension's handle, a
// file's fingerprint, a cache key), so the hashes are @noble/hashes' (audited,
// MIT, synchronous). Randomness is the browser's own `crypto.getRandomValues`.
// The stand-in plugin (web/node-stubs.js) takes every name exported here and
// stubs the rest of `node:crypto`, each throwing "not in the web edition".
//
// What `tests/web/crypto.spec.ts` holds: each call answers what Node's does.
import { Buffer } from 'buffer';
import { hmac } from '@noble/hashes/hmac.js';
import { md5, sha1 } from '@noble/hashes/legacy.js';
import { sha224, sha256, sha384, sha512 } from '@noble/hashes/sha2.js';

/** Each a hash noble can make incrementally. @type {Record<string, any>} */
const HASHES = { sha1, sha224, sha256, sha384, sha512, md5 };

/** @param {string} algorithm */
function hashOf(algorithm) {
	const h = HASHES[algorithm.toLowerCase().replace('-', '')];
	if (!h)
		throw new Error(
			`Digest method not supported: ${algorithm} (the web edition has ${Object.keys(HASHES).join(', ')})`
		);
	return h;
}

/** @param {unknown} data @param {string} [encoding] */
function bytes(data, encoding) {
	if (typeof data === 'string')
		return new Uint8Array(Buffer.from(data, /** @type {BufferEncoding} */ (encoding ?? 'utf8')));
	if (ArrayBuffer.isView(data))
		return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
	if (data instanceof ArrayBuffer) return new Uint8Array(data);
	throw new TypeError(
		'The "data" argument must be of type string or an instance of Buffer, TypedArray, or DataView'
	);
}

/** @param {Uint8Array} out @param {string} [encoding] */
function encode(out, encoding) {
	const buf = Buffer.from(out);
	return encoding ? buf.toString(/** @type {BufferEncoding} */ (encoding)) : buf;
}

/**
 * Wraps one of noble's incremental hashers in Node's Hash shape.
 * @param {{ update(b: Uint8Array): unknown, digest(): Uint8Array, clone(): any }} inner
 */
function nodeHash(inner) {
	let done = false;
	const self = {
		/** @param {unknown} data @param {string} [encoding] */
		update(data, encoding) {
			if (done) throw new Error('Digest already called');
			inner.update(bytes(data, encoding));
			return self;
		},
		/** @param {string} [encoding] */
		digest(encoding) {
			if (done) throw new Error('Digest already called');
			done = true;
			return encode(inner.digest(), encoding);
		},
		copy: () => nodeHash(inner.clone())
	};
	return self;
}

/** @param {string} algorithm */
export const createHash = (algorithm) => nodeHash(hashOf(algorithm).create());

/** @param {string} algorithm @param {unknown} key */
export const createHmac = (algorithm, key) => nodeHash(hmac.create(hashOf(algorithm), bytes(key)));

/** @param {string} algorithm @param {unknown} data @param {string} [encoding] */
export const hash = (algorithm, data, encoding = 'hex') =>
	createHash(algorithm).update(data).digest(encoding);

/**
 * @param {number} size
 * @param {(err: Error | null, buf: Buffer) => void} [callback]
 */
export function randomBytes(size, callback) {
	const out = new Uint8Array(size);
	// getRandomValues takes at most 64 KiB at a time.
	for (let at = 0; at < size; at += 65536)
		globalThis.crypto.getRandomValues(out.subarray(at, Math.min(at + 65536, size)));
	const buf = Buffer.from(out);
	if (callback) queueMicrotask(() => callback(null, buf));
	return buf;
}

/**
 * Node's randomInt: an integer in [min, max), without modulo bias.
 * @param {number} a @param {number | ((e: Error | null, n: number) => void)} [b] @param {(e: Error | null, n: number) => void} [c]
 */
export function randomInt(a, b, c) {
	const [min, max, callback] = typeof b === 'number' ? [a, b, c] : [0, a, b];
	if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max <= min)
		throw new RangeError(
			`The value of "max" is out of range. It must be greater than the value of "min" (${min}). Received ${max}`
		);
	const range = max - min;
	if (range > 2 ** 48)
		throw new RangeError('The difference between "max" and "min" must be at most 2^48');
	const limit = 2 ** 48 - (2 ** 48 % range);
	let n;
	do {
		const six = randomBytes(6);
		n = six.readUIntBE(0, 6);
	} while (n >= limit);
	const value = min + (n % range);
	if (callback) queueMicrotask(() => callback(null, value));
	return value;
}

/** In constant time for equal lengths, as Node's; unequal lengths throw, as Node's do. @param {ArrayBufferView} a @param {ArrayBufferView} b */
export function timingSafeEqual(a, b) {
	const x = bytes(a);
	const y = bytes(b);
	if (x.length !== y.length) throw new RangeError('Input buffers must have the same byte length');
	let diff = 0;
	for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
	return diff === 0;
}

export const randomUUID = () => globalThis.crypto.randomUUID();
/** @template {ArrayBufferView | null} T @param {T} array */
export const getRandomValues = (array) =>
	globalThis.crypto.getRandomValues(/** @type {any} */ (array));
export const webcrypto = globalThis.crypto;
export const subtle = globalThis.crypto?.subtle;
export const getHashes = () => Object.keys(HASHES);
