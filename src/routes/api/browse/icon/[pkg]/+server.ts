import { error } from '@sveltejs/kit';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from '$lib/server/fspath';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { isRevealed } from '$lib/server/prefs';
import { findListing, iconsDir } from '$lib/server/engine/extensions';
import { browseSources } from '$lib/server/engine/browse';
import { USER_AGENT } from '$lib/server/engine/protocol';
import { findNovelListing, installedPlugins } from '$lib/server/novels/plugins';

/**
 * An extension's icon, as BROWSE's rows show it (Browse Calls, "Read these
 * as mock data": "the real icon is the extension's own image, shown as a
 * cover is"). Fetched from its repository by the server once and kept beside
 * the APKs as an 80px WebP, so the viewer's browser never asks the
 * repository's host, and a dead repository doesn't take its icons with it.
 * Hidden means hidden: with reveal off, an extension whose every source is
 * mostly hidden, or an adult one not installed, answers 404.
 */

const SIZE = 80;

/**
 * An icon the viewer's lists could show: an installed extension with a
 * source they may see, or one available to install, 18+ ones included
 * (manage.ts's rules: only an extension whose every source is mostly hidden is
 * kept from a viewer without reveal).
 */
function mayShow(pkg: string, reveal: boolean): boolean {
	// An LNReader plugin (`ln:<id>`, doc/NOVELS.md): its index marks nothing adult.
	if (pkg.startsWith('ln:'))
		return (
			!!findNovelListing(pkg.slice(3)) || installedPlugins().some((p) => p.id === pkg.slice(3))
		);
	const mine = browseSources(true).filter((s) => s.pkg === pkg);
	if (mine.length > 0) return reveal || mine.some((s) => !s.mostlyHidden);
	const listing = findListing(pkg, getDb());
	// An 18+ extension is listed for everyone now, marked (doc/BROWSE.md, "Filters").
	return !!listing;
}

async function fetchIcon(pkg: string): Promise<Buffer | null> {
	const iconUrl = pkg.startsWith('ln:')
		? findNovelListing(pkg.slice(3))?.iconUrl
		: findListing(pkg, getDb())?.iconUrl;
	if (!iconUrl) return null;
	try {
		const res = await fetch(iconUrl, {
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
	if (!/^(ln:)?[A-Za-z0-9._-]{1,200}$/.test(pkg)) error(404, 'no icon');
	if (!mayShow(pkg, isRevealed(cookies))) error(404, 'no icon');
	const path = join(iconsDir(), `${pkg.replace(':', '-')}.webp`);
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
