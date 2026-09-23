/**
 * Accept the tablet's folders into the library folder (doc/SYNC.md). Run
 * once, after the tablet has been paired and has shared its folders:
 *
 *   yarn run sync-setup                        # show what's offered, change nothing
 *   yarn run sync-setup -- --device <ID>       # also accept that device, if it's waiting
 *   yarn run sync-setup -- --apply             # accept the offered folders
 *   yarn run sync-setup -- --apply --as <folder id>=Mihon
 *
 * Each offered folder is placed by its label (Mihon, Hentoid, Library; see
 * targetOf) or by --as, at LIBRARY_ROOT/<target>, receive-only, ignoring
 * deletes, with the ignore patterns that keep temp files out.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	FOLDER_SETTINGS,
	IGNORE_PATTERNS,
	SYNC_TARGETS,
	targetOf,
	type SyncTarget
} from '../src/lib/import/sync.ts';
import { st, type FolderConfig } from './syncthing.ts';

try {
	process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
} catch {
	// No .env: the defaults.
}

const library = resolve(process.env.LIBRARY_ROOT ?? '/mnt/hdd2/tsundoku/library');
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const deviceArg = args[args.indexOf('--device') + 1];
const as = new Map<string, SyncTarget>();
args.forEach((a, i) => {
	if (a !== '--as') return;
	const [id, target] = (args[i + 1] ?? '').split('=');
	if (!SYNC_TARGETS.includes(target as SyncTarget))
		throw new Error(`--as wants <folder id>=${SYNC_TARGETS.join('|')}`);
	as.set(id, target as SyncTarget);
});

type Pending = Record<string, { offeredBy: Record<string, { label: string }> }>;
type PendingDevices = Record<string, { name: string; address: string }>;

const devices = await st<PendingDevices>('/rest/cluster/pending/devices');
for (const [id, d] of Object.entries(devices)) {
	if (args.includes('--device') && id === deviceArg) {
		await st('/rest/config/devices', {
			method: 'POST',
			body: JSON.stringify({ deviceID: id, name: d.name || 'tablet', addresses: ['dynamic'] })
		});
		console.log(`accepted device ${d.name || '(unnamed)'} ${id}`);
	} else console.log(`device waiting: ${d.name || '(unnamed)'} ${id} (accept with --device ${id})`);
}

const existing = await st<FolderConfig[]>('/rest/config/folders');
const pending = await st<Pending>('/rest/cluster/pending/folders');
if (Object.keys(pending).length === 0) console.log('no folders offered yet.');
for (const [id, p] of Object.entries(pending)) {
	const [device, offer] = Object.entries(p.offeredBy)[0];
	const target = as.get(id) ?? targetOf(offer.label);
	if (!target) {
		console.log(
			`"${offer.label}" (${id}): not Mihon, Hentoid or Library; name it with --as ${id}=…`
		);
		continue;
	}
	const path = join(library, target);
	const taken = existing.find((f) => resolve(f.path) === path);
	if (taken) {
		console.log(`"${offer.label}" (${id}): ${path} is already folder ${taken.id}; skipped.`);
		continue;
	}
	if (!apply) {
		console.log(`"${offer.label}" (${id}) → ${path}  (--apply to accept)`);
		continue;
	}
	// The ignores first, so nothing temporary is received while the folder starts.
	mkdirSync(path, { recursive: true });
	writeFileSync(join(path, '.stignore'), `${IGNORE_PATTERNS.join('\n')}\n`);
	await st('/rest/config/folders', {
		method: 'POST',
		body: JSON.stringify({
			id,
			label: offer.label || target,
			path,
			devices: [{ deviceID: device }],
			...FOLDER_SETTINGS
		})
	});
	console.log(`"${offer.label}" (${id}) → ${path}: receive-only, deletes ignored.`);
}
