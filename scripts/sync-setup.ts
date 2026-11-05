/**
 * Accept the tablet's folders into the library folder (doc/SYNC.md). Run
 * once, after the tablet has been paired and has shared its folders:
 *
 *   yarn run sync-setup                        # show what's offered, change nothing
 *   yarn run sync-setup -- --device <ID>       # also accept that device, if it's waiting
 *   yarn run sync-setup -- --apply             # accept the offered folders
 *   yarn run sync-setup -- --apply --as <folder id>=Mihon
 *   yarn run sync-setup -- --apply --device-dir <device ID>=phone
 *
 * The library folder is one device's (the tablet's). Folders another device
 * offers go under `devices/<name>/` with --device-dir, and the importer reads
 * each device's Hentoid and Library and merges them; of the `Mihon/` folders
 * under `devices/` it reads only tsundoku's own (doc/SYNC.md, "Other devices").
 * --device can be given more than once.
 *
 * Each offered folder is placed by its label (Mihon, Hentoid, Library; see
 * targetOf) or by --as, at LIBRARY_ROOT/<target>, receive-only, ignoring
 * deletes, with the ignore patterns that keep temp files out.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from '../src/lib/server/fspath.ts';
import { fileURLToPath } from 'node:url';
import {
	FOLDER_SETTINGS,
	IGNORE_PATTERNS,
	SYNC_TARGETS,
	targetOf,
	type SyncTarget
} from '../src/lib/import/sync.ts';
import { st, type FolderConfig } from './syncthing.ts';
import { dataPaths } from '../src/lib/server/data-dirs.ts';

try {
	process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
} catch {
	// No .env: the defaults.
}

const library = resolve(dataPaths().library);
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const valuesOf = (flag: string) =>
	args.flatMap((a, i) => (a === flag && args[i + 1] ? [args[i + 1]] : []));
const accept = new Set(valuesOf('--device'));
const deviceDirs = new Map(
	valuesOf('--device-dir').map((v) => {
		const [id, name] = v.split('=');
		if (!id || !name || !/^[\w-]+$/.test(name))
			throw new Error('--device-dir wants <device ID>=<name>, the name a plain word');
		return [id, name] as const;
	})
);
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
	if (accept.has(id)) {
		await st('/rest/config/devices', {
			method: 'POST',
			body: JSON.stringify({ deviceID: id, name: d.name || 'tablet', addresses: ['dynamic'] })
		});
		console.log(`accepted device ${d.name || '(unnamed)'} ${id}`);
	} else console.log(`device waiting: ${d.name || '(unnamed)'} ${id} (accept with --device ${id})`);
}

const existing = await st<FolderConfig[]>('/rest/config/folders');
const names = new Map(
	(await st<{ deviceID: string; name: string }[]>('/rest/config/devices')).map((d) => [
		d.deviceID,
		d.name || d.deviceID.slice(0, 7)
	])
);
/** Paths taken, by folders already here and by those this run adds. */
const taken = new Map(existing.map((f) => [resolve(f.path), f.id]));
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
	const dir = deviceDirs.get(device);
	const path = dir ? join(library, 'devices', dir, target) : join(library, target);
	const from = names.get(device) ?? device.slice(0, 7);
	const holder = taken.get(path);
	if (holder) {
		console.log(
			`"${offer.label}" from ${from} (${id}): ${path} is already folder ${holder}; skipped. Another device? --device-dir ${device}=<name>`
		);
		continue;
	}
	taken.set(path, id);
	if (!apply) {
		console.log(`"${offer.label}" from ${from} (${id}) → ${path}  (--apply to accept)`);
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
	console.log(`"${offer.label}" from ${from} (${id}) → ${path}: receive-only, deletes ignored.`);
}
