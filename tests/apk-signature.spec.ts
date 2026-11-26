import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import {
	ApkSignatureError,
	certificateKey,
	signedBy,
	signerFingerprints
} from '$lib/server/engine/apk-signature';

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
	it('is the repository’s key, and verifies', async () => {
		expect(await signerFingerprints(apk)).toEqual([KEIYOUSHI]);
		expect(await signedBy(apk, KEIYOUSHI)).toBe(true);
		expect(await signedBy(apk, KEIYOUSHI.toUpperCase())).toBe(true);
	});

	it('is not another repository’s', async () => {
		expect(await signedBy(apk, YUZONO)).toBe(false);
	});

	// A genuine signing block on other code: what a fingerprint check alone lets through.
	it('fails when one byte of the code changes', async () => {
		expect(await signedBy(tamper(100), KEIYOUSHI)).toBe(false);
		await expect(signerFingerprints(tamper(100))).rejects.toThrow(/content does not match/);
	});

	it('fails when the central directory changes', async () => {
		const { cd } = blockAndDirectory();
		expect(await signedBy(tamper(cd + 40), KEIYOUSHI)).toBe(false);
	});

	it('fails when the signing block itself is altered', async () => {
		const { block } = blockAndDirectory();
		// Inside the signed data, past the block's own framing.
		expect(await signedBy(tamper(block + 120), KEIYOUSHI)).toBe(false);
	});

	it('refuses what isn’t a signed APK, rather than half-checking it', async () => {
		await expect(signerFingerprints(Buffer.from('not a zip'))).rejects.toThrow(ApkSignatureError);
		const { block, cd } = blockAndDirectory();
		// The same zip with its signing block cut out: signed with nothing, or v1 at best.
		const unsigned = Buffer.concat([apk.subarray(0, block), apk.subarray(cd)]);
		const eocd = unsigned.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
		unsigned.writeUInt32LE(block, eocd + 16);
		await expect(signerFingerprints(unsigned)).rejects.toThrow(/no APK signing block/);
		expect(await signedBy(unsigned, KEIYOUSHI)).toBe(false);
	});

	// The key is read from the certificate by a small DER walk, not Node's
	// X509Certificate (WebCrypto parses no certificates): it must be Node's key.
	it('reads the certificate’s key as Node does', () => {
		const cert = certificateOf(apk);
		expect(certificateKey(cert)).toEqual(
			new X509Certificate(cert).publicKey.export({ type: 'spki', format: 'der' })
		);
		expect(() => certificateKey(Buffer.from([0x30, 0x03, 0x02, 0x01, 0x00]))).toThrow(
			ApkSignatureError
		);
	});
});

/** The first signer's certificate, found by its DER header inside the signing block. */
function certificateOf(buf: Buffer): Buffer {
	const { block, cd } = blockAndDirectory();
	const region = buf.subarray(block, cd);
	for (let at = 0; at + 4 < region.length; at++)
		if (
			region[at] === 0x30 &&
			region[at + 1] === 0x82 &&
			region[at + 4] === 0x30 &&
			region[at + 5] === 0x82
		) {
			const len = region.readUInt16BE(at + 2) + 4;
			return Buffer.from(region.subarray(at, at + len));
		}
	throw new Error('no certificate in the fixture');
}
