import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ApkSignatureError, signedBy, signerFingerprints } from '$lib/server/engine/apk-signature';

// A real extension, signed by Keiyoushi (tests/fixtures/apk/README.md).
const apk = readFileSync('tests/fixtures/apk/tachiyomi-all.webtoons-v1.6.2.apk');
const KEIYOUSHI = '9add655a78e96c4ec7a53ef89dccb557cb5d767489fac5e785d671a5a75d4da2';
const YUZONO = 'cbec121aa82ebb02aaa73806992e0368a97d47b5451ed6524816d03084c45905';

const tamper = (at: number) => {
	const b = Buffer.from(apk);
	b[at] ^= 1;
	return b;
};

/** Where the v2 signing block starts and the central directory begins. */
function blockAndDirectory() {
	const eocd = apk.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
	const cd = apk.readUInt32LE(eocd + 16);
	const size = Number(apk.readBigUInt64LE(cd - 24));
	return { block: cd - size - 8, cd, eocd };
}

describe('an extension’s signature', () => {
	it('is the repository’s key, and verifies', () => {
		expect(signerFingerprints(apk)).toEqual([KEIYOUSHI]);
		expect(signedBy(apk, KEIYOUSHI)).toBe(true);
		expect(signedBy(apk, KEIYOUSHI.toUpperCase())).toBe(true);
	});

	it('is not another repository’s', () => {
		expect(signedBy(apk, YUZONO)).toBe(false);
	});

	// A genuine signing block on other code: what a fingerprint check alone lets through.
	it('fails when one byte of the code changes', () => {
		expect(signedBy(tamper(100), KEIYOUSHI)).toBe(false);
		expect(() => signerFingerprints(tamper(100))).toThrow(/content does not match/);
	});

	it('fails when the central directory changes', () => {
		const { cd } = blockAndDirectory();
		expect(signedBy(tamper(cd + 40), KEIYOUSHI)).toBe(false);
	});

	it('fails when the signing block itself is altered', () => {
		const { block } = blockAndDirectory();
		// Inside the signed data, past the block's own framing.
		expect(signedBy(tamper(block + 120), KEIYOUSHI)).toBe(false);
	});

	it('refuses what isn’t a signed APK, rather than half-checking it', () => {
		expect(() => signerFingerprints(Buffer.from('not a zip'))).toThrow(ApkSignatureError);
		const { block, cd } = blockAndDirectory();
		// The same zip with its signing block cut out: signed with nothing, or v1 at best.
		const unsigned = Buffer.concat([apk.subarray(0, block), apk.subarray(cd)]);
		const eocd = unsigned.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
		unsigned.writeUInt32LE(block, eocd + 16);
		expect(() => signerFingerprints(unsigned)).toThrow(/no APK signing block/);
		expect(signedBy(unsigned, KEIYOUSHI)).toBe(false);
	});
});
