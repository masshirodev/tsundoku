import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { isRevealed } from '$lib/server/prefs';
import { setSetting } from '$lib/server/settings';
import { VISIBLE_SQL } from '$lib/server/visibility';
import { refreshCovers } from '$lib/server/covers';
import { linkCount, linkQueueCount } from '$lib/server/catalogue';
import { accounts, retry, signOut } from '$lib/server/tracking';
import { ranobeAccount, ranobeQueueCount, retryRanobe } from '$lib/server/ranobe-review';
import { SERVICES, type Service } from '$lib/library/tracking';
import { downloadsBackend } from '$lib/server/engine/run';
import { browseLanguages } from '$lib/server/engine/browse';
import { listings } from '$lib/server/engine/extensions';
import {
	clearModes,
	isLibraryValue,
	libraryValues,
	modeOverrides,
	overrideCounts,
	setLibraryValue
} from '$lib/server/settings-page';
import { clearOverride, lastChoice, overrides } from '$lib/server/anime/choices';
import { isDeviceId, listDevices, setDeviceKey, startFrom } from '$lib/server/devices';
import { DEVICE_KEYS, type Json, type ValueId } from '$lib/settings/catalog';
import { currentLogin, friendLogin, localOnly, setSession, slowDown } from '$lib/server/auth';
import { dataPaths } from '$lib/server/data-dirs';
import { MIN_PASSWORD, makeLogin, sessionFor, verifyPassword, writeLogin } from '$lib/server/login';
import { checkIfStale, updateView } from '$lib/server/updates';

/** The languages the repositories list, most extensions first: the BROWSE row's cells. */
function listedLanguages(): string[] {
	const n = new Map<string, number>();
	for (const l of listings())
		for (const lang of new Set(l.sources.map((s) => s.lang.toLowerCase())))
			if (lang && lang !== 'all' && lang !== 'multi') n.set(lang, (n.get(lang) ?? 0) + 1);
	return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l);
}

const DEFAULT_LANGUAGES = ['en', 'ja'];

/** The cells shown: what's chosen, then the commonest others, twelve at most. */
const LANGUAGE_CELLS = 12;

/**
 * SETTINGS, one page (doc/SETTINGS.md; card c171, Settings.dc.html): every
 * setting once, in eight sections, each row saying where it's kept. The
 * library's values come from here; this device's are its browser's, and
 * another device's (2C) are the workstation's copy, listed under DEVICES.
 * Counts follow reveal, as every list does: hidden series aren't counted.
 */
export const load: PageServerLoad = async ({ cookies, url }) => {
	const reveal = isRevealed(cookies);
	const folded = (
		getDb()
			.prepare(
				`SELECT COUNT(*) AS n FROM series s JOIN roots r ON r.id = s.root_id
				WHERE (? OR ${VISIBLE_SQL})
				AND EXISTS (SELECT 1 FROM entries e WHERE e.series_id = s.id AND e.edition_of IS NOT NULL)`
			)
			.get(reveal ? 1 : 0) as { n: number }
	).n;
	return {
		values: libraryValues(),
		counts: overrideCounts(reveal),
		folded,
		// What N SERIES DIFFER → opens (2A).
		lists: {
			audio: overrides('audio', reveal),
			subs: overrides('subs', reveal),
			mode: modeOverrides(reveal)
		},
		// What FOLLOW THE PLAYER stands in with, said on WATCHING's meta line.
		last: {
			audio: lastChoice('audio', reveal),
			subs: lastChoice('subs', reveal),
			subsize: lastChoice('subsize', reveal)
		},
		// A friend's install looks for new versions (doc/UPDATES.md); null elsewhere.
		updates: (checkIfStale(60 * 60 * 1000), updateView()),
		// A friend's password, or none (doc/SIGN-IN.md); the workstation has its token.
		signIn: friendLogin()
			? {
					kind: currentLogin()?.kind ?? 'none',
					local: localOnly(),
					min: MIN_PASSWORD
				}
			: null,
		devices: listDevices().map((d) => ({
			id: d.id,
			kind: d.kind,
			label: d.label,
			seenAt: d.seenAt,
			settings: d.settings
		})),
		// CATALOGUES (Catalogue Links 1u, 1v; doc/TRACKING.md).
		catalogues: {
			linked: linkCount(),
			toReview: linkQueueCount(reveal) + ranobeQueueCount(),
			accounts: accounts(),
			// Ranobe's row (Ranobe 3a–3c; doc/RANOBE.md): no sign-in, a token in .env.
			ranobe: ranobeAccount()
		},
		// How a sign-in went, coming back from the catalogue.
		signin: url.searchParams.has('signin')
			? {
					outcome: url.searchParams.get('signin') ?? '',
					service: url.searchParams.get('service') ?? ''
				}
			: null,
		// BROWSE and DOWNLOADING need the engine (doc/BROWSE.md).
		browse:
			downloadsBackend() === 'engine'
				? (() => {
						const chosen = browseLanguages();
						// The defaults always have a cell, so one turned off can come back
						// even when no repository lists it.
						const rest = [...DEFAULT_LANGUAGES, ...listedLanguages()].filter(
							(l, i, all) => !chosen.includes(l) && all.indexOf(l) === i
						);
						return {
							chosen,
							cells: [...chosen, ...rest].slice(0, Math.max(LANGUAGE_CELLS, chosen.length))
						};
					})()
				: null
	};
};

const serviceOf = async (request: Request): Promise<Service | null> => {
	const s = String((await request.formData()).get('service') ?? '') as Service;
	return SERVICES.includes(s) ? s : null;
};

/** A value posted as JSON; absent is a reset. */
function posted(form: FormData): { ok: true; v: Json | undefined } | { ok: false } {
	const raw = form.get('v');
	if (raw === null) return { ok: true, v: undefined };
	try {
		return { ok: true, v: JSON.parse(String(raw)) as Json };
	} catch {
		return { ok: false };
	}
}

export const actions: Actions = {
	/**
	 * Set or change a friend's password. Changing it asks for the current one
	 * and signs every other browser out (a new secret); this one stays in.
	 */
	password: async ({ request, cookies, url }) => {
		const login = currentLogin();
		if (!friendLogin() || !login) return fail(404, { password: 'no password here' });
		const form = await request.formData();
		if (
			login.kind === 'password' &&
			!verifyPassword(String(form.get('current') ?? ''), login.hash)
		) {
			await slowDown();
			return fail(401, { password: 'the current password is not right' });
		}
		const next = String(form.get('password') ?? '');
		if (next.length < MIN_PASSWORD)
			return fail(400, { password: `at least ${MIN_PASSWORD} characters` });
		if (next !== String(form.get('again') ?? ''))
			return fail(400, { password: 'the two passwords are different' });
		const made = makeLogin(next);
		writeLogin(dataPaths().home, made);
		setSession(cookies, sessionFor(made), url);
		return { passwordDone: login.kind === 'password' ? 'PASSWORD CHANGED' : 'PASSWORD SET' };
	},
	/** Remove it: only while tsundoku answers this computer alone, and only once they're sure. */
	noPassword: async ({ request }) => {
		const login = currentLogin();
		if (!friendLogin() || login?.kind !== 'password')
			return fail(404, { password: 'no password here' });
		if (!localOnly())
			return fail(400, {
				password: 'not while tsundoku is on Tailscale: anyone there could open it'
			});
		const form = await request.formData();
		if (!verifyPassword(String(form.get('current') ?? ''), login.hash)) {
			await slowDown();
			return fail(401, { password: 'the current password is not right' });
		}
		if (form.get('sure') !== 'yes') return fail(400, { password: 'confirm it first' });
		writeLogin(dataPaths().home, makeLogin(null));
		return { passwordDone: 'PASSWORD REMOVED' };
	},
	/**
	 * A library value set or reset (a row's control, RESET, RESET SECTION, UNDO).
	 * Several at once, so a section resets in one request: `id` repeated, each
	 * with its `v` in the same order, or none for a reset.
	 */
	set: async ({ request }) => {
		const form = await request.formData();
		const ids = form.getAll('id').map(String);
		const vs = form.getAll('v').map(String);
		if (!ids.length || ids.some((id) => !isLibraryValue(id)))
			return fail(400, { message: 'no such setting' });
		if (vs.length && vs.length !== ids.length) return fail(400, { message: 'a value each' });
		for (const [i, id] of ids.entries()) {
			let v: Json | undefined;
			try {
				v = vs.length ? (JSON.parse(vs[i]) as Json) : undefined;
			} catch {
				return fail(400, { message: 'not a value' });
			}
			if (setLibraryValue(id as ValueId, v) === false)
				return fail(400, { message: `${id} can't be that` });
			// Folded books wear their opening edition's cover: which one may have changed.
			if (id === 'edition.language') {
				const series = (
					getDb()
						.prepare(`SELECT DISTINCT series_id AS id FROM entries WHERE edition_of IS NOT NULL`)
						.all() as { id: number }[]
				).map((r) => r.id);
				if (series.length) void refreshCovers({ ids: series, remote: false });
			}
		}
		return { ok: true };
	},

	/** ✕ on one series that differs, or CLEAR ALL N (2A): back on the default. */
	clear: async ({ request }) => {
		const form = await request.formData();
		const what = String(form.get('what'));
		const ids = form.getAll('series').map(Number).filter(Number.isInteger);
		if (!ids.length) return fail(400, { message: 'which series' });
		if (what === 'audio' || what === 'subs') clearOverride(what, ids);
		else if (what === 'mode') clearModes(ids);
		else return fail(400, { message: 'no such default' });
		return { ok: true };
	},

	/** Another device's value changed from here (2C): it takes it when it next opens. */
	device: async ({ request }) => {
		const form = await request.formData();
		const id = String(form.get('device'));
		const key = String(form.get('key'));
		const p = posted(form);
		if (!isDeviceId(id) || !DEVICE_KEYS.includes(key) || !p.ok)
			return fail(400, { message: 'no such device setting' });
		if (!setDeviceKey(id, key, p.v ?? null)) return fail(404, { message: 'no such device' });
		return { ok: true };
	},

	/** START FROM another device (question 1). */
	startFrom: async ({ request }) => {
		const form = await request.formData();
		const id = String(form.get('device'));
		const from = String(form.get('from'));
		if (!startFrom(id, from)) return fail(400, { message: 'no such device' });
		return { ok: true };
	},

	signOut: async ({ request }) => {
		const s = await serviceOf(request);
		if (!s) return fail(400, { message: 'which catalogue' });
		signOut(s);
		return { ok: true };
	},
	retry: async ({ request }) => {
		const s = await serviceOf(request);
		if (!s) return fail(400, { message: 'which catalogue' });
		return { retried: await retry(s) };
	},
	retryRanobe: async () => {
		await retryRanobe();
		return { ok: true };
	},
	/** A language in or out of BROWSE's; at least one stays, or nothing would be listed. */
	browseLanguage: async ({ request }) => {
		const l = String((await request.formData()).get('lang') ?? '').toLowerCase();
		if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(l)) return fail(400, { message: 'no such language' });
		const now = browseLanguages();
		const next = now.includes(l) ? now.filter((x) => x !== l) : [...now, l];
		if (next.length === 0) return fail(400, { message: 'BROWSE needs one language' });
		setSetting('browse_languages', next.join(','));
		return { ok: true };
	}
};
