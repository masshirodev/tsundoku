import { createHash, createPublicKey, verify, X509Certificate } from 'node:crypto';

/**
 * Whether an extension's APK is what its repository signed: Android's APK
 * Signature Scheme v2 (https://source.android.com/docs/security/features/apksigning/v2),
 * checked as Android checks it at install, and then the signer's certificate
 * against the repository's `signingKeyFingerprint`, which is how Mihon trusts
 * a repository's extensions.
 *
 * Both halves, because either alone passes a forgery: a fingerprint check
 * alone accepts a genuine signing block grafted onto other code, and a
 * signature check alone accepts code signed by anyone. An extension is code
 * the engine runs with the source's cookies, so an APK that fails either is
 * UNTRUSTED (doc/BROWSE.md) and never installed.
 *
 * Every repository extension checked (Keiyoushi's, Yuzono's) was signed
 * with v2 alone. v3 and v1-only APKs are refused rather than half-checked.
 */

export class ApkSignatureError extends Error {}

const MAGIC = Buffer.from('APK Sig Block 42');
const V2_BLOCK = 0x7109871a;
const CHUNK = 1024 * 1024;

/** The signature algorithms v2 defines, and the content digest each uses. */
const ALGORITHMS: Record<number, { hash: 'sha256' | 'sha512'; pss?: boolean; dsa?: boolean }> = {
	0x0101: { hash: 'sha256', pss: true },
	0x0102: { hash: 'sha512', pss: true },
	0x0103: { hash: 'sha256' },
	0x0104: { hash: 'sha512' },
	0x0201: { hash: 'sha256' },
	0x0202: { hash: 'sha512' },
	0x0301: { hash: 'sha256', dsa: true }
};

/** A cursor over length-prefixed (uint32) values, v2's only framing. */
class Reader {
	private at = 0;
	// A plain field: Node's type stripping, which the scripts run under, can't load parameter properties.
	private readonly buf: Buffer;
	constructor(buf: Buffer) {
		this.buf = buf;
	}
	get done() {
		return this.at >= this.buf.length;
	}
	u32(): number {
		if (this.at + 4 > this.buf.length) throw new ApkSignatureError('truncated signing block');
		const v = this.buf.readUInt32LE(this.at);
		this.at += 4;
		return v;
	}
	prefixed(): Buffer {
		const len = this.u32();
		if (this.at + len > this.buf.length) throw new ApkSignatureError('truncated signing block');
		const v = this.buf.subarray(this.at, this.at + len);
		this.at += len;
		return v;
	}
	/** A length-prefixed sequence of length-prefixed values. */
	sequence(): Buffer[] {
		const r = new Reader(this.prefixed());
		const out: Buffer[] = [];
		while (!r.done) out.push(r.prefixed());
		return out;
	}
}

type Layout = { blockStart: number; cdStart: number; eocdStart: number; block: Buffer };

/** Where the signing block, central directory and end record are. */
function layout(apk: Buffer): Layout {
	const eocdStart = apk.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
	if (eocdStart < 0 || eocdStart + 22 > apk.length) throw new ApkSignatureError('not a zip');
	const cdStart = apk.readUInt32LE(eocdStart + 16);
	if (cdStart < 32 || !apk.subarray(cdStart - 16, cdStart).equals(MAGIC))
		throw new ApkSignatureError('no APK signing block (unsigned, or signed with v1 only)');
	const size = Number(apk.readBigUInt64LE(cdStart - 24));
	const blockStart = cdStart - size - 8;
	if (blockStart < 0 || Number(apk.readBigUInt64LE(blockStart)) !== size)
		throw new ApkSignatureError('malformed APK signing block');
	return { blockStart, cdStart, eocdStart, block: apk.subarray(blockStart + 8, cdStart - 24) };
}

function v2Value(block: Buffer): Buffer {
	let at = 0;
	while (at + 12 <= block.length) {
		const len = Number(block.readBigUInt64LE(at));
		const id = block.readUInt32LE(at + 8);
		if (id === V2_BLOCK) return block.subarray(at + 12, at + 8 + len);
		at += 8 + len;
	}
	throw new ApkSignatureError('no v2 signature (v3-only signing is not checked)');
}

/**
 * v2's content digest: the zip's entries, its central directory, and its end
 * record (with the directory's offset pointing where the signing block
 * starts, as if it weren't there), each cut into 1 MiB chunks, every chunk
 * hashed with its length, and the chunk hashes hashed together.
 */
function contentDigest(apk: Buffer, l: Layout, hash: 'sha256' | 'sha512'): Buffer {
	const eocd = Buffer.from(apk.subarray(l.eocdStart));
	eocd.writeUInt32LE(l.blockStart, 16);
	const sections = [apk.subarray(0, l.blockStart), apk.subarray(l.cdStart, l.eocdStart), eocd];
	const chunks: Buffer[] = [];
	for (const s of sections)
		for (let at = 0; at < s.length; at += CHUNK) {
			const part = s.subarray(at, Math.min(at + CHUNK, s.length));
			const head = Buffer.alloc(5);
			head[0] = 0xa5;
			head.writeUInt32LE(part.length, 1);
			chunks.push(createHash(hash).update(head).update(part).digest());
		}
	const head = Buffer.alloc(5);
	head[0] = 0x5a;
	head.writeUInt32LE(chunks.length, 1);
	const top = createHash(hash).update(head);
	for (const c of chunks) top.update(c);
	return top.digest();
}

const pair = (b: Buffer) => {
	const r = new Reader(b);
	return { algorithm: r.u32(), value: r.prefixed() };
};

/** Prefers SHA-512 over SHA-256, as Android picks the strongest it supports. */
const strength = (algorithm: number) => (ALGORITHMS[algorithm]?.hash === 'sha512' ? 2 : 1);

/**
 * The SHA-256 fingerprints (lowercase hex) of the certificates that signed
 * [apk], after checking each signer's signature over its signed data, its
 * certificate against the key that signature verifies with, and the content
 * digest it signed against the APK's own bytes. Throws ApkSignatureError when
 * anything doesn't hold.
 */
export function signerFingerprints(apk: Buffer): string[] {
	const l = layout(apk);
	const signers = new Reader(v2Value(l.block)).sequence();
	if (signers.length === 0) throw new ApkSignatureError('no signers');
	const computed = new Map<string, Buffer>();
	return signers.map((raw) => {
		const signer = new Reader(raw);
		const signedData = signer.prefixed();
		const signatures = signer.sequence().map(pair);
		const publicKey = signer.prefixed();

		const supported = signatures
			.filter((s) => ALGORITHMS[s.algorithm])
			.sort((a, b) => strength(b.algorithm) - strength(a.algorithm));
		if (supported.length === 0)
			throw new ApkSignatureError('no signature in an algorithm v2 defines');
		const best = supported[0];
		const algo = ALGORITHMS[best.algorithm];
		const key = createPublicKey({ key: publicKey, format: 'der', type: 'spki' });
		const ok = verify(
			algo.hash,
			signedData,
			algo.pss
				? {
						key,
						padding: 6 /* RSA_PKCS1_PSS_PADDING */,
						saltLength: algo.hash === 'sha512' ? 64 : 32
					}
				: key,
			best.value
		);
		if (!ok) throw new ApkSignatureError('signature does not verify');

		const data = new Reader(signedData);
		const digests = data.sequence().map(pair);
		const certificates = data.sequence();
		// The signed list of digests has to be the list of signatures' algorithms.
		const signedAlgorithms = digests.map((d) => d.algorithm).sort();
		const signatureAlgorithms = signatures.map((s) => s.algorithm).sort();
		if (signedAlgorithms.join() !== signatureAlgorithms.join())
			throw new ApkSignatureError('signed digests and signatures disagree');
		const digest = digests.find((d) => d.algorithm === best.algorithm)!;
		const mine =
			computed.get(algo.hash) ??
			computed.set(algo.hash, contentDigest(apk, l, algo.hash)).get(algo.hash)!;
		if (!mine.equals(digest.value))
			throw new ApkSignatureError('content does not match its signed digest');

		if (certificates.length === 0) throw new ApkSignatureError('no certificate');
		const cert = new X509Certificate(certificates[0]);
		if (!cert.publicKey.export({ type: 'spki', format: 'der' }).equals(publicKey))
			throw new ApkSignatureError('certificate is not the signing key');
		return createHash('sha256').update(certificates[0]).digest('hex');
	});
}

/** Whether [apk] is signed, validly, by the key whose fingerprint a repository publishes. */
export function signedBy(apk: Buffer, fingerprint: string): boolean {
	try {
		return signerFingerprints(apk).includes(fingerprint.toLowerCase().replaceAll(':', ''));
	} catch (e) {
		if (e instanceof ApkSignatureError) return false;
		throw e;
	}
}
