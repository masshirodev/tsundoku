import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { isRevealed } from '$lib/server/prefs';
import { downloadsBackend } from '$lib/server/engine/run';
import { browseSource, forgetSource } from '$lib/server/engine/browse';
import { callSource } from '$lib/server/engine/backend';
import { EngineError } from '$lib/server/engine/client';
import { keepPreferences, preferences, setPreference } from '$lib/server/engine/extensions';
import type { Preference } from '$lib/server/engine/protocol';
import { settingOf, valueFromForm } from '$lib/library/source-settings';
import { backOrigin } from '$lib/library/tag-search';

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
	const s = browseSource(id, reveal);
	// A novel plugin keeps no settings here (doc/NOVELS.md): the family is
	// asked, not the kind (card c420).
	if (!s || s.family === 'lnreader') error(404, 'not found');
	return s;
}

const rank = (order: string[], key: string) => {
	const i = order.indexOf(key);
	return i < 0 ? order.length : i;
};

export const load: PageServerLoad = async ({ params, cookies, url }) => {
	const s = source(params.source, isRevealed(cookies));
	let down: string | null = null;
	// The source's own order, when it answered; the keys' otherwise.
	let order: string[] = [];
	if (!s.failed) {
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
		settings: preferences(s.id)
			.map(settingOf)
			.filter((x) => x !== null)
			.sort((a, b) => rank(order, a.key) - rank(order, b.key)),
		down,
		change: url.searchParams.get('change') ?? '',
		// The source page's tag origin (card c453): ← and every row keep it.
		from: backOrigin(url.searchParams.get('from'))
	};
};

export const actions: Actions = {
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
