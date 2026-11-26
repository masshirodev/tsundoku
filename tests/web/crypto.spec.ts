/**
 * The web edition's `node:crypto` (web/crypto.js, doc/WEB-EDITION.md,
 * "Crypto"): each call answers what Node's own answers, synchronous as Node's,
 * since the server code hashes inline.
 */
import { describe, expect, it } from 'vitest';
import * as node from 'node:crypto';
import * as web from '../../web/crypto.js';

const inputs: [string, string | Uint8Array][] = [
	['empty', ''],
	['text', 'tsundoku'],
	['unicode', '積ん読 · 読書'],
	['bytes', new Uint8Array(70_000).map((_, i) => (i * 31) % 256)]
];

describe('hashes, as Node makes them', () => {
	for (const algorithm of ['sha1', 'sha256', 'sha512', 'md5', 'sha384', 'sha224'])
		for (const [name, data] of inputs)
			it(`${algorithm} of ${name}`, () => {
				expect(web.createHash(algorithm).update(data).digest('hex')).toBe(
					node.createHash(algorithm).update(data).digest('hex')
				);
			});

	it('in parts, in every encoding Node digests to, and as a Buffer', () => {
		const n = node.createHash('sha256').update('a').update(Buffer.from('b')).update('63', 'hex');
		const w = web.createHash('sha256').update('a').update(Buffer.from('b')).update('63', 'hex');
		const copy = w.copy();
		expect(w.digest('base64')).toBe(n.copy().digest('base64'));
		expect(copy.digest()).toEqual(n.digest());
		expect(web.hash('sha1', 'x')).toBe(node.createHash('sha1').update('x').digest('hex'));
	});

	it('a hash digested twice throws, as Node’s does', () => {
		const h = web.createHash('sha256');
		h.digest();
		expect(() => h.digest()).toThrow('Digest already called');
		expect(() => h.update('x')).toThrow('Digest already called');
	});

	it('an algorithm it has not got says which it has', () => {
		expect(() => web.createHash('whirlpool')).toThrow(/Digest method not supported: whirlpool/);
	});

	it('HMAC, as Node makes it', () => {
		for (const algorithm of ['sha1', 'sha256'])
			expect(web.createHmac(algorithm, 'key').update('message').digest('hex')).toBe(
				node.createHmac(algorithm, 'key').update('message').digest('hex')
			);
	});
});

describe('randomness and comparisons', () => {
	it('randomBytes: as many as asked, more than one getRandomValues at a time, and by callback', async () => {
		expect(web.randomBytes(16)).toHaveLength(16);
		const big = web.randomBytes(200_000);
		expect(big).toHaveLength(200_000);
		expect(big.subarray(100_000).some((b) => b !== 0)).toBe(true);
		const viaCallback = await new Promise<Buffer>((resolve, reject) =>
			web.randomBytes(8, (e, b) => (e ? reject(e) : resolve(b)))
		);
		expect(viaCallback).toHaveLength(8);
	});

	it('randomInt: in range, with one bound or two, and refuses an empty range', () => {
		for (let i = 0; i < 200; i++) {
			const n = web.randomInt(10);
			expect(n).toBeGreaterThanOrEqual(0);
			expect(n).toBeLessThan(10);
			const m = web.randomInt(-5, 5);
			expect(m).toBeGreaterThanOrEqual(-5);
			expect(m).toBeLessThan(5);
		}
		expect(() => web.randomInt(3, 3)).toThrow(RangeError);
	});

	it('timingSafeEqual: as Node’s, unequal lengths throwing', () => {
		const a = Buffer.from('same');
		expect(web.timingSafeEqual(a, Buffer.from('same'))).toBe(true);
		expect(web.timingSafeEqual(a, Buffer.from('diff'))).toBe(false);
		expect(() => web.timingSafeEqual(a, Buffer.from('longer'))).toThrow(RangeError);
		expect(() => node.timingSafeEqual(a, Buffer.from('longer'))).toThrow(RangeError);
	});

	it('randomUUID is the browser’s', () => {
		expect(web.randomUUID()).toMatch(/^[0-9a-f-]{36}$/);
	});
});
