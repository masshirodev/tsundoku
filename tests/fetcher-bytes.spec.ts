/**
 * Bodies between the fetcher's content script and its background
 * (src/lib/fetcher/bytes.ts): as bytes where the browser clones them, as
 * base64 where it serialises to JSON, and the probe that tells which.
 */
import { describe, expect, it } from 'vitest';
import {
	decodeBody,
	encodeBody,
	fromBase64,
	isBytes,
	probeBytes,
	probeSurvived,
	toBase64
} from '../src/lib/fetcher/bytes.ts';

const every = Uint8Array.from({ length: 256 }, (_, i) => i);

describe('base64', () => {
	it('round-trips every byte value', () => {
		expect(fromBase64(toBase64(every))).toEqual(every);
		expect(toBase64(new Uint8Array([104, 105]))).toBe('aGk=');
	});

	it('handles a body larger than one chunk', () => {
		const big = Uint8Array.from({ length: 200_000 }, (_, i) => (i * 7) % 256);
		expect(fromBase64(toBase64(big))).toEqual(big);
	});
});

describe('encodeBody and decodeBody', () => {
	it('pass bytes as they are where the browser clones', () => {
		const wire = encodeBody(every, 'binary');
		expect(wire).toEqual({ binary: every });
		expect(decodeBody(wire)).toBe(every);
	});

	it('pass base64 where it serialises', () => {
		const wire = encodeBody(every, 'base64');
		expect(wire).toEqual({ base64: toBase64(every) });
		expect(decodeBody(wire)).toEqual(every);
	});

	it('read no body as an empty one', () => {
		expect(decodeBody(null)).toEqual(new Uint8Array(0));
		expect(decodeBody(undefined)).toEqual(new Uint8Array(0));
	});

	it('refuse bytes that arrived as something else, as JSON turns them', () => {
		const jsoned = JSON.parse(JSON.stringify({ binary: every }));
		expect(() => decodeBody(jsoned)).toThrow('a binary body arrived as something else');
	});
});

describe('the probe', () => {
	it('survives a structured clone, as in Firefox', () => {
		expect(probeSurvived(structuredClone(probeBytes()))).toBe(true);
	});

	it('does not survive JSON, as in Chromium', () => {
		expect(probeSurvived(JSON.parse(JSON.stringify(probeBytes())))).toBe(false);
	});

	it('does not survive being cut or changed', () => {
		expect(probeSurvived(probeBytes().subarray(1))).toBe(false);
		const changed = probeBytes();
		changed[200] = 0;
		expect(probeSurvived(changed)).toBe(false);
		expect(probeSurvived(undefined)).toBe(false);
	});

	it('recognises bytes from another realm by their tag', () => {
		const foreign = { [Symbol.toStringTag]: 'Uint8Array' };
		expect(isBytes(foreign)).toBe(true);
		expect(isBytes([1, 2])).toBe(false);
	});
});
