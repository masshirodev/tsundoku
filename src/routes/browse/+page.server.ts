import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { concealBand, undoConceal } from './conceal.server';
import {
	addedBand,
	bandShelves,
	newShelfAdded,
	shelveAdded,
	standingRefusal,
	undoAdded
} from './added.server';
import { isRevealed } from '$lib/server/prefs';
import { downloadsBackend } from '$lib/server/engine/run';
import { browseList, noteSolvedChecks } from '$lib/server/engine/browse';
import { fillWebViewFlags } from '$lib/server/engine/extensions';
import { mark } from '$lib/server/engine/webview';
import { kindOfSource } from '../downloads/search/kinds.server';
import { kindAsked, kindsServed } from '../downloads/search/source-kinds';
import type { Kind } from '$lib/library/kinds';

/**
 * BROWSE (sources; doc/BROWSE.md): every installed
 * source in the user's languages, RECENT first, then by kind. Read from
 * tsundoku's own tables, so it draws even while the engine isn't answering.
 */
export const load: PageServerLoad = async ({ cookies, url }) => {
	if (downloadsBackend() !== 'engine') error(404, 'not found');
	const reveal = isRevealed(cookies);
	// Sites the engine has passed a check for since it started, so their lines say so.
	await noteSolvedChecks();
	// Extensions installed before tsundoku asked whether they use a WebView, read once (migration 78).
	await fillWebViewFlags();
	const added = await addedBand(url.searchParams, null, reveal);
	const all = browseList(reveal);
	// The KIND band (doc/BROWSE.md, "The KIND band"): each source's own kind,
	// the one SEARCH THE SOURCES asks (the user's choice, else its family's),
	// so a Mihon source marked MANHWA is under MANHWA and an Aniyomi one marked
	// SHOWS under SHOWS. The cells count sources, as reveal lets them be seen.
	const sources = [...all.manga, ...all.anime, ...all.novels];
	const kindOf = new Map(sources.map((r) => [r.id, kindOfSource(r.id)]));
	const served = kindsServed(sources.map((r) => ({ kind: kindOf.get(r.id) ?? null })));
	const kind = kindAsked(url.searchParams.get('kind'), served);
	const counts: Partial<Record<Kind, number>> = {};
	for (const k of kindOf.values()) if (k) counts[k] = (counts[k] ?? 0) + 1;
	const ofKind = <R extends { id: string }>(rows: R[]) =>
		kind === null ? rows : rows.filter((r) => kindOf.get(r.id) === kind);
	const list = {
		...all,
		recent: ofKind(all.recent),
		manga: ofKind(all.manga),
		anime: ofKind(all.anime),
		novels: ofKind(all.novels)
	};
	const rows = [...list.recent, ...list.manga, ...list.anime];
	return {
		list,
		// One kind or none to tell apart draws no band, as SEARCH THE SOURCES'.
		kindBand:
			served.length > 1
				? {
						kind,
						all: sources.length,
						cells: served.map((k) => ({ kind: k, n: counts[k] ?? 0 }))
					}
				: null,
		// NEEDS A WEBVIEW, in words where this install can't give one
		// (doc/BROWSE.md, "Extensions that need a WebView"). The engine is asked
		// only when a listed source needs one.
		webviewMark: rows.some((r) => r.webview) ? await mark() : null,
		reveal,
		now: Date.now(),
		// CONCEAL ITS SERIES outside reveal: the source is mostly
		// hidden now, so its settings page is not found and the band is here.
		concealed: concealBand(url.searchParams),
		// ADD outside reveal that left its source mostly hidden: the
		// source's page is not found, so the ADDED band is here. It names the
		// source only when this viewer may see it.
		added,
		// The shelves its series is on, for the band's chips.
		addedShelves: bandShelves(added),
		// A refused UNDO from a source's page, which can no longer draw its own
		// band: the refusal's code is the URL's, its words are here --
		// while it still holds, re-asked on every load.
		refused: standingRefusal(url.searchParams.get('refused'), added)
	};
};

export const actions: Actions = {
	/** UNDO on CONCEAL's band, here: the same UNDO as the settings page's (`undoConceal`). */
	undoConceal: async ({ request }) => {
		// As the load: off the engine backend this page does not exist, so neither does its action.
		if (downloadsBackend() !== 'engine') error(404, 'not found');
		const refused = undoConceal(await request.formData());
		if (refused) return fail(409, { message: refused });
		redirect(303, '/browse');
	},
	/** UNDO on the ADDED band, here: the same UNDO as the source page's (`undoAdded`). */
	undoAdd: async ({ request, cookies }) => {
		if (downloadsBackend() !== 'engine') error(404, 'not found');
		const r = await undoAdded(await request.formData(), null, isRevealed(cookies));
		if ('to' in r) redirect(303, r.to);
		return fail(r.status, { added: r.message });
	},
	/** PUT ON A SHELF on the ADDED band, here: the same chip as the source page's (`shelveAdded`). */
	shelve: async ({ request }) => {
		if (downloadsBackend() !== 'engine') error(404, 'not found');
		const r = await shelveAdded(await request.formData(), null);
		if ('status' in r) return fail(r.status, { shelf: r.message });
		return { shelved: r };
	},
	/** + NEW SHELF on the ADDED band, here (`newShelfAdded`). */
	newShelf: async ({ request, url }) => {
		if (downloadsBackend() !== 'engine') error(404, 'not found');
		const r = await newShelfAdded(
			await request.formData(),
			request.headers.get('referer'),
			url,
			null
		);
		if ('status' in r) return fail(r.status, { shelf: r.message });
		redirect(303, r.to);
	}
};
