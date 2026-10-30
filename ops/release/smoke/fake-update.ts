/**
 * A pretend newer release, for the updater's smoke test on Windows
 * (smoke/windows-update.ps1; doc/UPDATES.md): a latest.json announcing
 * 9999.01.01, whose installer is the one under test, signed with the real
 * release key. Only the manifest is made here; the test machine puts the
 * installer it already has where the manifest says.
 *
 *   node --experimental-strip-types fake-update.ts <installer.exe> <latest.json to write>
 */
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { openManifest, type Manifest } from '../../../src/lib/server/update-manifest.ts';

const [installer, out] = process.argv.slice(2);
const key =
	process.env.TSUNDOKU_SIGNING_KEY ?? join(homedir(), '.config/tsundoku/release-signing.pem');
const manifest: Manifest = {
	version: '9999.01.01',
	date: '9999-01-01',
	notes: 'The smoke test’s pretend release.',
	files: {
		'win-x64': {
			installer: {
				name: 'tsundoku-win-x64.exe',
				size: statSync(installer).size,
				sha256: createHash('sha256').update(readFileSync(installer)).digest('hex')
			}
		}
	}
};
const text = JSON.stringify(manifest);
const signature = sign(null, Buffer.from(text), createPrivateKey(readFileSync(key))).toString(
	'base64'
);
const latest = JSON.stringify({ manifest: text, signature });
if (!openManifest(latest).ok)
	throw new Error('the release key doesn’t match the builds’ public key');
writeFileSync(out, latest);
