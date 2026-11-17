import { generateKeyPairSync, sign } from 'node:crypto';
import type { Manifest } from '../../src/lib/server/update-manifest.ts';

/** A release key of the tests' own, and latest.json texts signed with it. */
export function testKey() {
	const { publicKey, privateKey } = generateKeyPairSync('ed25519');
	const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
	const signed = (manifest: Manifest | string) => {
		const text = typeof manifest === 'string' ? manifest : JSON.stringify(manifest);
		return JSON.stringify({
			manifest: text,
			signature: sign(null, Buffer.from(text, 'utf8'), privateKey).toString('base64')
		});
	};
	return { raw, signed };
}

const file = (name: string, size: number) => ({ name, size, sha256: 'a'.repeat(64) });

export const MANIFEST: Manifest = {
	version: '2026.11.01.2',
	date: '2026-11-01',
	notes: 'First line <b>with markup</b>.\n\nSecond & last line.',
	files: {
		'win-x64': {
			installer: file('tsundoku-win-x64.exe', 242362191),
			zip: file('tsundoku-win-x64.zip', 300000000)
		},
		'linux-x64': { archive: file('tsundoku-linux-x64.tar.xz', 242000000) }
	}
};

/**
 * A manifest shaped like a release with the Android apps: the same desktop files, plus the two
 * APKs under `files.android` and the names, sizes and hashes publish.ts gives
 * them. The real saved fixture stays the no-android case (most releases).
 */
export const ANDROID_MANIFEST: Manifest = {
	...MANIFEST,
	files: {
		...MANIFEST.files,
		android: {
			app: { name: 'tsundoku-app.apk', size: 44040192, sha256: 'b'.repeat(64) },
			tv: { name: 'tsundoku-tv.apk', size: 33554432, sha256: 'c'.repeat(64) }
		}
	}
};
