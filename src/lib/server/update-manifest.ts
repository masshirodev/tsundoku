import { createPublicKey, verify } from 'node:crypto';

/**
 * What a release says about itself to installed copies (doc/UPDATES.md):
 * `latest.json` at dl.tsundoku.masshiro.pro, written by
 * ops/release/publish.ts. It is a manifest, as a string, and an ed25519
 * signature over exactly those bytes, so nothing has to agree on how JSON is
 * spelled. The private key never leaves the workstation; the public one is
 * below, in every build. A copy refuses any manifest it can't verify, and
 * any file whose size and SHA-256 aren't the manifest's: the download host
 * only serves files, it is never trusted to choose them.
 */

/** The release key's public half, raw (`openssl pkey -pubout -outform DER | tail -c 32`). */
export const RELEASE_KEY = 'Hlve1oAMzIIHVslirdojPxPNwaqQwwNcWLQmUijh8q0=';

// An ed25519 SubjectPublicKeyInfo is this fixed prefix, then the 32 raw bytes.
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export type ReleaseFile = { name: string; size: number; sha256: string };

export type Manifest = {
	version: string;
	/** YYYY-MM-DD. */
	date: string;
	/** For a friend: what changed, in a few lines. */
	notes: string;
	files: {
		'win-x64'?: { installer?: ReleaseFile; zip?: ReleaseFile };
		'linux-x64'?: { archive?: ReleaseFile };
		/**
		 * The Android apps (doc/UPDATES.md, "The Android apps"): the phone
		 * and tablet app and the TV's, each checked by the app itself against
		 * this same signature (the app's ReleaseCheck.kt).
		 */
		android?: { app?: ReleaseFile; tv?: ReleaseFile };
	};
};

export type Signed = { manifest: string; signature: string };

export const VERSION_RE = /^\d{4}\.\d{2}\.\d{2}(\.\d+)?$/;

/** a > b, for release versions (YYYY.MM.DD[.N]); 2026.10.30 < 2026.10.30.1. */
export function newer(a: string, b: string): boolean {
	const pa = a.split('.').map(Number);
	const pb = b.split('.').map(Number);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const x = pa[i] ?? 0;
		const y = pb[i] ?? 0;
		if (x !== y) return x > y;
	}
	return false;
}

const isFile = (f: unknown): f is ReleaseFile => {
	const r = f as ReleaseFile;
	return (
		!!r &&
		typeof r.name === 'string' &&
		/^[\w.-]+$/.test(r.name) &&
		Number.isInteger(r.size) &&
		r.size > 0 &&
		typeof r.sha256 === 'string' &&
		/^[0-9a-f]{64}$/.test(r.sha256)
	);
};

/**
 * The manifest in a latest.json, if its signature is the release key's and
 * it is well formed; otherwise why not. `key` is for tests.
 */
export function openManifest(
	text: string,
	key = RELEASE_KEY
): { ok: true; manifest: Manifest } | { ok: false; reason: string } {
	let signed: Signed;
	try {
		signed = JSON.parse(text) as Signed;
	} catch {
		return { ok: false, reason: 'not JSON' };
	}
	if (typeof signed?.manifest !== 'string' || typeof signed?.signature !== 'string')
		return { ok: false, reason: 'not a signed manifest' };
	const publicKey = createPublicKey({
		key: Buffer.concat([SPKI_PREFIX, Buffer.from(key, 'base64')]),
		format: 'der',
		type: 'spki'
	});
	let good: boolean;
	try {
		good = verify(
			null,
			Buffer.from(signed.manifest, 'utf8'),
			publicKey,
			Buffer.from(signed.signature, 'base64')
		);
	} catch {
		good = false;
	}
	if (!good) return { ok: false, reason: 'the signature is not the release key’s' };
	let m: Manifest;
	try {
		m = JSON.parse(signed.manifest) as Manifest;
	} catch {
		return { ok: false, reason: 'the manifest is not JSON' };
	}
	if (!VERSION_RE.test(m?.version ?? '')) return { ok: false, reason: 'no version' };
	if (typeof m.notes !== 'string' || typeof m.date !== 'string')
		return { ok: false, reason: 'no notes or date' };
	const files = [
		m.files?.['win-x64']?.installer,
		m.files?.['win-x64']?.zip,
		m.files?.['linux-x64']?.archive,
		m.files?.android?.app,
		m.files?.android?.tv
	].filter((f) => f !== undefined);
	if (!files.every(isFile)) return { ok: false, reason: 'a file entry is malformed' };
	return { ok: true, manifest: m };
}

/** Where a release's file is: its version's own folder, never `latest/`, so the hash is that version's. */
export const fileUrl = (base: string, m: Manifest, f: ReleaseFile) =>
	`${base.replace(/\/+$/, '')}/${m.version}/${f.name}`;
