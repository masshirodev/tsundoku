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
 *
 * The cryptography is WebCrypto (`crypto.subtle`), which Node and every
 * browser have alike, so the web edition checks exactly what the self-hosted
 * app checks (doc/WEB-EDITION.md, "Installing an extension"). It is
 * asynchronous, so these are. WebCrypto has no DSA: a DSA signature (v2's
 * 0x0301, which no repository checked uses) is verified by Node's own crypto
 * where there is one, and refused in the browser.
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
async function contentDigest(apk: Buffer, l: Layout, hash: 'sha256' | 'sha512'): Promise<Buffer> {
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
			chunks.push(await digestOf(hash, head, part));
		}
	const head = Buffer.alloc(5);
	head[0] = 0x5a;
	head.writeUInt32LE(chunks.length, 1);
	return digestOf(hash, head, ...chunks);
}

/** The digest of the given parts, one after another. */
async function digestOf(hash: 'sha256' | 'sha512', ...parts: Uint8Array[]): Promise<Buffer> {
	const all = Buffer.concat(parts);
	return Buffer.from(await crypto.subtle.digest(hash === 'sha256' ? 'SHA-256' : 'SHA-512', all));
}

/** A DER value: its tag, the whole of it, and where its contents are. */
type Der = { tag: number; whole: Buffer; contents: Buffer };

/** Reads the DER value at [at] in [buf] (definite lengths only, as DER is). */
function derAt(buf: Buffer, at: number): Der {
	if (at + 2 > buf.length) throw new ApkSignatureError('truncated certificate');
	const tag = buf[at];
	let len = buf[at + 1];
	let start = at + 2;
	if (len & 0x80) {
		const n = len & 0x7f;
		if (n === 0 || n > 4 || start + n > buf.length)
			throw new ApkSignatureError('malformed certificate');
		len = 0;
		for (let i = 0; i < n; i++) len = len * 256 + buf[start + i];
		start += n;
	}
	if (start + len > buf.length) throw new ApkSignatureError('truncated certificate');
	return { tag, whole: buf.subarray(at, start + len), contents: buf.subarray(start, start + len) };
}

/** The values inside a constructed DER value, in order. */
function derChildren(der: Der): Der[] {
	const out: Der[] = [];
	for (let at = 0; at < der.contents.length;) {
		const child = derAt(der.contents, at);
		out.push(child);
		at += child.whole.length;
	}
	return out;
}

/**
 * The subject public key (SubjectPublicKeyInfo, DER) of an X.509 certificate:
 * Certificate → tbsCertificate → [version], serial, signature, issuer,
 * validity, subject, subjectPublicKeyInfo.
 */
export function certificateKey(cert: Buffer): Buffer {
	const certificate = derAt(cert, 0);
	const [tbs] = derChildren(certificate);
	if (!tbs || tbs.tag !== 0x30) throw new ApkSignatureError('malformed certificate');
	const fields = derChildren(tbs);
	const start = fields[0]?.tag === 0xa0 ? 1 : 0; // [0] version, present from v2 on
	const spki = fields[start + 5];
	if (!spki || spki.tag !== 0x30) throw new ApkSignatureError('malformed certificate');
	return Buffer.from(spki.whole);
}

/** The named curve of an EC public key, from its SubjectPublicKeyInfo. */
function curveOf(spki: Buffer): 'P-256' | 'P-384' | 'P-521' {
	const hex = spki.toString('hex');
	if (hex.includes('06082a8648ce3d030107')) return 'P-256';
	if (hex.includes('06052b81040022')) return 'P-384';
	if (hex.includes('06052b81040023')) return 'P-521';
	throw new ApkSignatureError('an EC key on a curve v2 does not define');
}

/** An ECDSA signature as WebCrypto takes it: r and s side by side, not DER. */
function rawEcdsa(der: Buffer, curve: 'P-256' | 'P-384' | 'P-521'): Buffer {
	const size = curve === 'P-256' ? 32 : curve === 'P-384' ? 48 : 66;
	const parts = derChildren(derAt(der, 0));
	if (parts.length !== 2) throw new ApkSignatureError('malformed ECDSA signature');
	const out = Buffer.alloc(size * 2);
	parts.forEach((p, i) => {
		let v = p.contents;
		while (v.length > size && v[0] === 0) v = v.subarray(1);
		if (v.length > size) throw new ApkSignatureError('malformed ECDSA signature');
		v.copy(out, i * size + size - v.length);
	});
	return out;
}

/** A copy WebCrypto takes: its own ArrayBuffer, never a Buffer's shared pool. */
const own = (b: Uint8Array) => new Uint8Array(b);

/** Whether [signature] over [data] verifies with [spki], in v2's [algorithm]. */
async function verifies(
	algorithm: number,
	spki: Buffer,
	data: Buffer,
	signature: Buffer
): Promise<boolean> {
	const algo = ALGORITHMS[algorithm];
	const hash = algo.hash === 'sha512' ? 'SHA-512' : 'SHA-256';
	if (algo.dsa) return dsaVerifies(spki, data, signature);
	if (algorithm === 0x0201 || algorithm === 0x0202) {
		const namedCurve = curveOf(spki);
		const key = await importKey(spki, { name: 'ECDSA', namedCurve });
		return crypto.subtle.verify(
			{ name: 'ECDSA', hash },
			key,
			own(rawEcdsa(signature, namedCurve)),
			own(data)
		);
	}
	if (algo.pss) {
		const key = await importKey(spki, { name: 'RSA-PSS', hash });
		return crypto.subtle.verify(
			{ name: 'RSA-PSS', saltLength: algo.hash === 'sha512' ? 64 : 32 },
			key,
			own(signature),
			own(data)
		);
	}
	const key = await importKey(spki, { name: 'RSASSA-PKCS1-v1_5', hash });
	return crypto.subtle.verify({ name: 'RSASSA-PKCS1-v1_5' }, key, own(signature), own(data));
}

async function importKey(spki: Buffer, algorithm: RsaHashedImportParams | EcKeyImportParams) {
	try {
		return await crypto.subtle.importKey('spki', own(spki), algorithm, false, ['verify']);
	} catch {
		throw new ApkSignatureError('a public key this signature cannot use');
	}
}

/**
 * DSA, which WebCrypto has not got: Node's own crypto where there is one. In
 * the web edition `node:crypto` is a stand-in, and the APK is refused.
 */
async function dsaVerifies(spki: Buffer, data: Buffer, signature: Buffer): Promise<boolean> {
	try {
		const { createPublicKey, verify } = await import('node:crypto');
		const key = createPublicKey({ key: spki, format: 'der', type: 'spki' });
		return verify('sha256', data, key, signature);
	} catch {
		throw new ApkSignatureError('a DSA signature, which only the self-hosted app checks');
	}
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
export async function signerFingerprints(apk: Buffer): Promise<string[]> {
	const l = layout(apk);
	const signers = new Reader(v2Value(l.block)).sequence();
	if (signers.length === 0) throw new ApkSignatureError('no signers');
	const computed = new Map<string, Buffer>();
	const fingerprints: string[] = [];
	for (const raw of signers) {
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
		if (!(await verifies(best.algorithm, publicKey, signedData, best.value)))
			throw new ApkSignatureError('signature does not verify');

		const data = new Reader(signedData);
		const digests = data.sequence().map(pair);
		const certificates = data.sequence();
		// The signed list of digests has to be the list of signatures' algorithms.
		const signedAlgorithms = digests.map((d) => d.algorithm).sort();
		const signatureAlgorithms = signatures.map((s) => s.algorithm).sort();
		if (signedAlgorithms.join() !== signatureAlgorithms.join())
			throw new ApkSignatureError('signed digests and signatures disagree');
		const digest = digests.find((d) => d.algorithm === best.algorithm)!;
		let mine = computed.get(algo.hash);
		if (!mine) computed.set(algo.hash, (mine = await contentDigest(apk, l, algo.hash)));
		if (!mine.equals(digest.value))
			throw new ApkSignatureError('content does not match its signed digest');

		if (certificates.length === 0) throw new ApkSignatureError('no certificate');
		if (!certificateKey(certificates[0]).equals(publicKey))
			throw new ApkSignatureError('certificate is not the signing key');
		fingerprints.push((await digestOf('sha256', certificates[0])).toString('hex'));
	}
	return fingerprints;
}

/** Whether [apk] is signed, validly, by the key whose fingerprint a repository publishes. */
export async function signedBy(apk: Buffer, fingerprint: string): Promise<boolean> {
	try {
		return (await signerFingerprints(apk)).includes(fingerprint.toLowerCase().replaceAll(':', ''));
	} catch (e) {
		if (e instanceof ApkSignatureError) return false;
		throw e;
	}
}
