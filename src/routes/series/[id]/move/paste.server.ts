import { getDb } from '$lib/server/db';
import { sourceMangaId, sourceMedium } from '$lib/server/engine/backend';
import { kindFacts, type MoveKind } from '$lib/library/kinds';

/*
 * MOVE's PASTE A LINK (doc/MOVE.md): which installed source a pasted address
 * names. Out of +page.server.ts so a spec can ask it (SvelteKit refuses any
 * other export there); tests/move-db.spec.ts holds it to the rule it replaced.
 */

/** A pasted address on a source's site, matched to the installed source of the series' kind that serves it. */
export function pastedSourceId(url: string, kind: MoveKind): string | null {
	let host: string;
	try {
		host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
	} catch {
		return null;
	}
	const rows = getDb()
		.prepare(
			`SELECT s.id, s.base_url FROM engine_sources s JOIN engine_extensions e ON e.pkg = s.pkg
			WHERE e.failed = ''`
		)
		.all() as { id: string; base_url: string }[];
	const hit = rows.find((r) => {
		// The source's medium, never its family's name (c304).
		if (sourceMedium(r.id) !== kindFacts(kind).medium) return false;
		try {
			const base = new URL(r.base_url).hostname.replace(/^www\./, '').toLowerCase();
			return host === base || host.endsWith(`.${base}`) || base.endsWith(`.${host}`);
		} catch {
			return false;
		}
	});
	return hit ? sourceMangaId(hit.id, url) : null;
}
