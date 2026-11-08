import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { isRevealed } from '$lib/server/prefs';
import { downloadsBackend } from '$lib/server/engine/run';
import { browseSource, forgetSource } from '$lib/server/engine/browse';
import { isSourceFlag, setSourceFlag, sourceFlags } from '$lib/server/engine/source-flags';
import { callSource } from '$lib/server/engine/backend';
import { EngineError } from '$lib/server/engine/client';
import { keepPreferences, preferences, setPreference } from '$lib/server/engine/extensions';
import type { Preference } from '$lib/server/engine/protocol';
import { settingOf, valueFromForm } from '$lib/library/source-settings';
import { keepOrigin, settingsOrigin } from '$lib/library/tag-search';
import { conceal, concealBand, concealCount, undoConceal } from '../../conceal.server';
import { holdPost } from '../../test-hold.server';

/**
 * A source's settings (Index-Browse, settings; Browse Calls, "Settings, per
 * type"; doc/BROWSE.md; card c145). The engine describes them
 * (`preferencesManga`) and tsundoku keeps the values, sending them with
 * every call, since the engine keeps none across a restart. The description
 * is asked for on each visit, so a source that grew a setting shows it; the
 * values are tsundoku's.
 */

function source(id: string, reveal: boolean) {
	if (downloadsBackend() !== 'engine') error(404, 'not found');
	// Every family has the page (card c435): tsundoku's own switches are
	// every source's. Hidden means hidden: a hidden source's page is found
	// only inside reveal, as its BROWSE page is.
	const s = browseSource(id, reveal);
	if (!s) error(404, 'not found');
	return s;
}

/** Whether the extension has preferences of its own to describe: an LNReader plugin keeps none (doc/NOVELS.md). */
const hasPreferences = (s: { family: string }) => s.family !== 'lnreader';

const rank = (order: string[], key: string) => {
	const i = order.indexOf(key);
	return i < 0 ? order.length : i;
};

export const load: PageServerLoad = async ({ params, cookies, url }) => {
	const s = source(params.source, isRevealed(cookies));
	let down: string | null = null;
	// The source's own order, when it answered; the keys' otherwise.
	let order: string[] = [];
	if (!s.failed && hasPreferences(s)) {
		try {
			const described = await callSource<Preference[]>(s.id, 'preferencesManga', {}, 20_000);
			const list = Array.isArray(described) ? described : [];
			keepPreferences(s.id, list);
			order = list.map((p) => p.key);
		} catch (e) {
			// What tsundoku kept still shows, and still saves: it's sent with the next call.
			down = e instanceof EngineError && e.failure === 'down' ? 'down' : (e as Error).message;
		}
	}
	return {
		source: s,
		// tsundoku's own switches for it (card c435), above the extension's.
		flags: sourceFlags(s.id),
		preferences: hasPreferences(s),
		settings: preferences(s.id)
			.map(settingOf)
			.filter((x) => x !== null)
			.sort((a, b) => rank(order, a.key) - rank(order, b.key)),
		down,
		change: url.searchParams.get('change') ?? '',
		// Where ← returns (cards c453, c727): the source page's tag origin, kept
		// through here, or EXTENSIONS' list when its SETTINGS cell opened this.
		// ← and every row keep it.
		from: settingsOrigin(url.searchParams.get('from')),
		// CONCEAL ITS SERIES (card c523): what the press would hide, its
		// question without script (`?ask=conceal`), and the band after it.
		conceal: concealCount(s.id),
		askConceal: url.searchParams.get('ask') === 'conceal',
		concealed: url.searchParams.get('of') === s.id ? concealBand(url.searchParams) : null
	};
};

/**
 * Where CONCEAL and its UNDO land: this page while it is still found, with
 * `query` (the band) and the origin kept (a tag's, or EXTENSIONS'); BROWSE once it is not. Outside
 * reveal a source whose every series is hidden is mostly hidden, so CONCEAL
 * there always lands on BROWSE, whose band names no source.
 */
function landing(sourceId: string, reveal: boolean, from: string | null, query: string): string {
	if (browseSource(sourceId, reveal)) {
		const page = `/browse/${encodeURIComponent(sourceId)}/settings${query ? `?${query}` : ''}`;
		return keepOrigin(page, settingsOrigin(from));
	}
	return `/browse${query ? `?${query}` : ''}`;
}

export const actions: Actions = {
	/** One of tsundoku's own switches (card c435): HIDDEN SOURCE, ADDED HIDDEN, OFF HISTORY. */
	flag: async ({ params, cookies, request }) => {
		const s = source(params.source, isRevealed(cookies));
		const form = await request.formData();
		const flag = String(form.get('flag') ?? '');
		const value = String(form.get('value') ?? '');
		if (!isSourceFlag(flag)) return fail(400, { message: 'No such switch' });
		if (value !== 'true' && value !== 'false') return fail(400, { message: 'Not on or off' });
		const on = value === 'true';
		// The browse world's hold (tests/browse-setup.ts, c636): off in any build
		// the owner runs, and only the post that asks for it waits.
		await holdPost('flag', request);
		setSourceFlag(s.id, flag, on);
		// Hidden means hidden: hidden with reveal off, the source is no longer
		// found, this page included, so the switch lands on BROWSE.
		if (flag === 'hidden' && on && !isRevealed(cookies)) redirect(303, '/browse');
		return { saved: `flag:${flag}` };
	},
	/**
	 * CONCEAL ITS SERIES (card c523): every series from the source the library
	 * shows, hidden now through the Work rule, with the band and UNDO. Refused
	 * when nothing from it is shown (the cell is disabled then too).
	 */
	conceal: async ({ params, cookies, url }) => {
		const reveal = isRevealed(cookies);
		const s = source(params.source, reveal);
		const done = conceal(s.id);
		if (!done.ok) return fail(409, { message: done.message });
		redirect(303, landing(s.id, reveal, url.searchParams.get('from'), done.query));
	},
	/** UNDO on CONCEAL's band: what it hid and is still hidden, shown again (`undoConceal`). */
	undoConceal: async ({ params, cookies, request, url }) => {
		const reveal = isRevealed(cookies);
		const s = source(params.source, reveal);
		const refused = undoConceal(await request.formData());
		if (refused) return fail(409, { message: refused });
		redirect(303, landing(s.id, reveal, url.searchParams.get('from'), ''));
	},
	/** One setting's new value. The source's page asks again on return: its kept answers are keyed by settings. */
	set: async ({ params, cookies, request }) => {
		const s = source(params.source, isRevealed(cookies));
		const form = await request.formData();
		const key = String(form.get('key') ?? '');
		const setting = preferences(s.id)
			.map(settingOf)
			.find((x) => x?.key === key);
		if (!setting) return fail(400, { message: 'No such setting' });
		const value = valueFromForm(setting, form.getAll('value').map(String));
		if (value === null) return fail(400, { message: 'Not one of its values' });
		setPreference(s.id, key, value);
		forgetSource(s.id);
		return { saved: key };
	}
};
