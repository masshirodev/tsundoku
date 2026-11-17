import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
	RELEASE_KEY,
	fileUrl,
	newer,
	openManifest,
	type Manifest
} from '../src/lib/server/update-manifest.ts';

// A key of the test's own: the release key's private half never leaves the workstation.
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
const other = generateKeyPairSync('ed25519').privateKey;

const file = (name: string) => ({ name, size: 1234, sha256: 'a'.repeat(64) });
const manifest: Manifest = {
	version: '2026.11.02',
	date: '2026-11-02',
	notes: 'Passwords instead of a token.\nAn updater.',
	files: {
		'win-x64': { installer: file('tsundoku-win-x64.exe'), zip: file('tsundoku-win-x64.zip') },
		'linux-x64': { archive: file('tsundoku-linux-x64.tar.xz') },
		android: { app: file('tsundoku-app.apk'), tv: file('tsundoku-tv.apk') }
	}
};
const signed = (m: unknown, key = privateKey) => {
	const text = typeof m === 'string' ? m : JSON.stringify(m);
	return JSON.stringify({
		manifest: text,
		signature: sign(null, Buffer.from(text), key).toString('base64')
	});
};

describe('latest.json (doc/UPDATES.md)', () => {
	it('opens when the release key signed it', () => {
		const r = openManifest(signed(manifest), raw);
		expect(r).toEqual({ ok: true, manifest });
	});

	it('refuses another key’s signature, and a manifest changed after signing', () => {
		expect(openManifest(signed(manifest, other), raw)).toMatchObject({ ok: false });
		const s = JSON.parse(signed(manifest)) as { manifest: string; signature: string };
		s.manifest = s.manifest.replace('1234', '1235');
		expect(openManifest(JSON.stringify(s), raw)).toMatchObject({
			ok: false,
			reason: expect.stringMatching(/signature/)
		});
		// And the real release key never verifies a test key's signature.
		expect(openManifest(signed(manifest), RELEASE_KEY)).toMatchObject({ ok: false });
	});

	it('refuses what isn’t a well-formed, signed manifest', () => {
		expect(openManifest('nope', raw)).toMatchObject({ ok: false, reason: 'not JSON' });
		expect(openManifest('{}', raw)).toMatchObject({ ok: false });
		expect(openManifest(signed('not json'), raw)).toMatchObject({ ok: false });
		expect(openManifest(signed({ ...manifest, version: 'v2' }), raw)).toMatchObject({
			ok: false,
			reason: 'no version'
		});
		// A file name that could climb out of the version's folder.
		const bad = structuredClone(manifest);
		bad.files['win-x64']!.installer = file('../evil.exe');
		expect(openManifest(signed(bad), raw)).toMatchObject({ ok: false });
		const badHash = structuredClone(manifest);
		badHash.files['linux-x64']!.archive = { ...file('x.tar.xz'), sha256: 'nope' };
		expect(openManifest(signed(badHash), raw)).toMatchObject({ ok: false });
	});

	it('carries the Android apps, and refuses a malformed one as any other file', () => {
		const r = openManifest(signed(manifest), raw);
		expect(r.ok && r.manifest.files.android?.app?.name).toBe('tsundoku-app.apk');
		const bad = { ...manifest, files: { ...manifest.files, android: { app: file('../x.apk') } } };
		expect(openManifest(signed(bad), raw)).toMatchObject({
			ok: false,
			reason: 'a file entry is malformed'
		});
		// A release from before c614 has no Android entry, and still opens.
		const old = { ...manifest, files: { 'win-x64': manifest.files['win-x64'] } };
		expect(openManifest(signed(old), raw)).toMatchObject({ ok: true });
	});

	it('orders release versions, a suffix after its day', () => {
		expect(newer('2026.10.30.1', '2026.10.30')).toBe(true);
		expect(newer('2026.10.30', '2026.10.30.1')).toBe(false);
		expect(newer('2026.11.02', '2026.10.30.9')).toBe(true);
		expect(newer('2026.10.30', '2026.10.30')).toBe(false);
		expect(newer('2027.01.01', '2026.12.31.4')).toBe(true);
	});

	it('takes a file from its version’s own folder, never latest/', () => {
		expect(
			fileUrl('https://dl.tsundoku.masshiro.pro/', manifest, manifest.files['win-x64']!.installer!)
		).toBe('https://dl.tsundoku.masshiro.pro/2026.11.02/tsundoku-win-x64.exe');
	});
});
