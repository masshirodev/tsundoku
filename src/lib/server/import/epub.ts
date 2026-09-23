import { existsSync } from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import {
	parseContainer,
	parseNav,
	parseNcx,
	parsePackage,
	type Package,
	type TocPoint
} from '../../epub/epub.ts';
import { planEpub } from '../../import/epub-plan.ts';
import type { PlannedSeries } from '../../import/plan.ts';
import { listZip, readMember } from '../zip.ts';

/**
 * The EPUB importer's disk side (doc/IMPORT-EPUB.md): every `.epub` under the
 * tablet's `Library/` folder, which is where Moon+ Reader's books were.
 */

export function epubRoot(libraryRoot: string): string | null {
	for (const name of ['Library', 'Books'])
		if (existsSync(join(libraryRoot, name))) return join(libraryRoot, name);
	return null;
}

async function epubFiles(dir: string): Promise<string[]> {
	const out: string[] = [];
	for (const d of await readdir(dir, { withFileTypes: true })) {
		const path = join(dir, d.name);
		if (d.isDirectory()) out.push(...(await epubFiles(path)));
		else if (/\.epub$/i.test(d.name)) out.push(path);
	}
	return out.sort();
}

export async function epubBytes(root: string): Promise<number> {
	let n = 0;
	for (const f of await epubFiles(root)) n += (await stat(f)).size;
	return n;
}

/** The parts of one EPUB the plan needs; a file that won't parse comes back with none. */
export async function readEpub(
	path: string
): Promise<{ pkg: Package | null; toc: TocPoint[]; sizes: Map<string, number> }> {
	const fh = await open(path);
	try {
		const members = await listZip(fh, (await fh.stat()).size);
		const byName = new Map(members.map((m) => [m.name, m]));
		const sizes = new Map(members.map((m) => [m.name, m.size]));
		const text = async (name: string) => {
			const m = byName.get(name);
			return m ? (await readMember(fh, m)).toString('utf8') : null;
		};
		const container = await text('META-INF/container.xml');
		if (!container) return { pkg: null, toc: [], sizes };
		const opfPath = parseContainer(container);
		const opf = await text(opfPath);
		if (!opf) return { pkg: null, toc: [], sizes };
		const pkg = parsePackage(opf, opfPath);
		const ncx = pkg.ncx ? await text(pkg.ncx) : null;
		let toc = ncx ? parseNcx(ncx, pkg.ncx!) : [];
		if (toc.length === 0 && pkg.nav) {
			const nav = await text(pkg.nav);
			if (nav) toc = parseNav(nav, pkg.nav);
		}
		return { pkg, toc, sizes };
	} catch {
		return { pkg: null, toc: [], sizes: new Map() };
	} finally {
		await fh.close();
	}
}

export async function planEpubFolder(
	root: string,
	library: string,
	progress: (p: { bytes: number; failed: boolean }) => void,
	now: number
): Promise<PlannedSeries[]> {
	const out: PlannedSeries[] = [];
	for (const path of await epubFiles(root)) {
		const st = await stat(path);
		const parts = await readEpub(path);
		progress({ bytes: st.size, failed: parts.pkg === null });
		out.push(
			planEpub({
				relPath: relative(library, path),
				dir: dirname(path),
				file: basename(path),
				addedAt: Math.round(st.mtimeMs) || now,
				...parts
			})
		);
	}
	return out;
}
