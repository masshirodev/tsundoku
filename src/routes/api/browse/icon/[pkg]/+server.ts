import { error } from '@sveltejs/kit';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { isRevealed } from '$lib/server/prefs';
import { findListing, iconsDir } from '$lib/server/engine/extensions';
import { browseSources } from '$lib/server/engine/browse';
import { USER_AGENT } from '$lib/server/engine/protocol';

/**
 * An extension's icon, as BROWSE's rows show it (Browse Calls, "Read these
 * as mock data": "the real icon is the extension's own image, shown as a
 * cover is"). Fetched from its repository by the server once and kept beside
 * the APKs as an 80px WebP, so the viewer's browser never asks the
 * repository's host, and a dead repository doesn't take its icons with it.
 * Hidden means hidden: an extension whose every source is mostly hidden
 * answers 404 with reveal off.
 */

const SIZE = 80;

async function fetchIcon(pkg: string): Promise<Buffer | null> {
	const listing = findListing(pkg, getDb());
	if (!listing?.iconUrl) return null;
	try {
		const res = await fetch(listing.iconUrl, {
			headers: { 'user-agent': USER_AGENT },
			signal: AbortSignal.timeout(10_000)
		});
		if (!res.ok) return null;
		process.env.VIPS_WARNING ??= '0';
		const sharp = (await import('sharp')).default;
		return await sharp(Buffer.from(await res.arrayBuffer()), { failOn: 'none' })
			.resize(SIZE, SIZE, { fit: 'cover' })
			.webp({ quality: 80 })
			.toBuffer();
	} catch {
		return null;
	}
}

export const GET: RequestHandler = async ({ params, cookies }) => {
	const pkg = params.pkg;
	if (!/^[A-Za-z0-9._-]{1,200}$/.test(pkg)) error(404, 'no icon');
	if (!browseSources(isRevealed(cookies)).some((s) => s.pkg === pkg)) error(404, 'no icon');
	const path = join(iconsDir(), `${pkg}.webp`);
	let bytes: Buffer | null = existsSync(path) ? readFileSync(path) : null;
	if (!bytes) {
		bytes = await fetchIcon(pkg);
		if (!bytes) error(404, 'no icon');
		mkdirSync(iconsDir(), { recursive: true });
		writeFileSync(`${path}.partial`, bytes);
		renameSync(`${path}.partial`, path);
	}
	return new Response(new Uint8Array(bytes), {
		headers: { 'content-type': 'image/webp', 'cache-control': 'private, max-age=604800' }
	});
};
