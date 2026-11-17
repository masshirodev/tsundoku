import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { parseExtFilters } from '$lib/library/ext-filters';
import { isRevealed } from '$lib/server/prefs';
import { downloadsBackend } from '$lib/server/engine/run';
import { familyOfKind, RepoError } from '$lib/server/engine/repo-index';
import {
	addRepo,
	back,
	fillWebViewFlags,
	findListing,
	install,
	installed,
	listRepos,
	previewRepo,
	refreshRepo,
	removeRepo,
	UntrustedError
} from '$lib/server/engine/extensions';
import {
	availableView,
	installedView,
	loadAgain,
	novelsAvailable,
	pluginsShown,
	removal,
	removeExtension
} from '$lib/server/engine/manage';
import { browseLanguages, browseSources, forgetSource } from '$lib/server/engine/browse';
import { mark } from '$lib/server/engine/webview';
import type { Kind } from '$lib/server/engine/repo-index';
import { SOURCE_KINDS, type SourceFamily } from '$lib/library/kinds';
import {
	addNovelRepo,
	backPlugin,
	installPlugin,
	installedPlugins,
	listNovelRepos,
	pluginRemoval,
	pluginView,
	previewNovelRepo,
	refreshNovelRepo,
	reloadPlugin,
	removeNovelRepo,
	removePlugin
} from '$lib/server/novels/plugins';
import { isNovelRepoAddress, NovelRepoError } from '$lib/library/lnreader-index';
import { holdPost } from '../test-hold.server';
import { getDb } from '$lib/server/db';
import {
	SOURCE_FLAGS,
	isSourceFlag,
	sourceFlagsOf,
	type SourceFlag
} from '$lib/server/engine/source-flags';
import {
	TooManySourcesError,
	applyFlag,
	bandQuery,
	decodeFacts,
	encodeFacts,
	flagsBand,
	installedPackages,
	listParam,
	packageSources,
	planFlag,
	pluginOf,
	pressFits,
	selectQuery,
	tickedPackages,
	undoFlagPress,
	undoRefusal
} from './select.server';

/**
 * EXTENSIONS, BROWSE's back room (Index-Extensions: installed, remove,
 * available, availableReveal, repos, notRepo; doc/BROWSE.md, "Extensions and
 * repositories"). Three tabs in the URL (`tab`), and every action
 * a form post, so it all works without script. Nothing updates by itself:
 * UPDATE and UPDATE ALL ask, and BACK TO undoes an update for a week.
 */

type Tab = 'installed' | 'available' | 'repos';

const PAGE = '/browse/extensions';

function guard() {
	if (downloadsBackend() !== 'engine') error(404, 'not found');
}

/** An extension's package, or an LNReader plugin as `ln:<id>` (doc/NOVELS.md). */
const pkgOf = (form: FormData) => {
	const pkg = String(form.get('pkg') ?? '');
	if (!/^(ln:)?[A-Za-z0-9._-]{1,200}$/.test(pkg)) error(400, 'no such extension');
	return pkg;
};

/** An update or BACK TO changes what a source answers: its kept answers go. */
const forgetPackage = (pkg: string) =>
	browseSources(true)
		.filter((s) => s.pkg === pkg)
		.forEach((s) => forgetSource(s.id));

/** A refusal the page draws as a band, not an error page. */
/**
 * A refused install, update or repository, in tsundoku.log at WARN
 * (doc/LOGS.md): the band is gone once dismissed, and a friend's SETTINGS ›
 * REPORT is the only way the cause reaches the user. The message carries the
 * URL that answered; an untrusted APK adds its signers beside the expected key.
 */
function warnRefused(subject: string, e: unknown) {
	console.error(
		`tsundoku: extensions: WARN ${subject} refused: ${(e as Error)?.message || 'failed'}` +
			(e instanceof UntrustedError
				? ` (signed by ${e.signers.join(', ') || 'no key'}, expected ${e.expected || 'none'})`
				: '')
	);
}

function refusal(e: unknown, pkg = '', subject = pkg) {
	warnRefused(subject, e);
	if (e instanceof UntrustedError)
		return fail(409, {
			pkg,
			untrusted: true,
			message: e.message,
			signers: e.signers,
			expected: e.expected
		});
	if (e instanceof RepoError || e instanceof NovelRepoError)
		return fail(502, { pkg, message: e.message });
	return fail(502, { pkg, message: (e as Error).message || 'failed' });
}

/** The packages INSTALLED draws now, as the selection may hold them. */
function drawnPackages(
	installedNow: {
		needsHand: { pkg: string }[];
		updates: { pkg: string }[];
		current: { pkg: string }[];
	},
	pluginsNow: { needsHand: { id: string }[]; updates: { id: string }[]; current: { id: string }[] }
): Set<string> {
	return new Set([
		...[...installedNow.needsHand, ...installedNow.updates, ...installedNow.current].map(
			(r) => r.pkg
		),
		...[...pluginsNow.needsHand, ...pluginsNow.updates, ...pluginsNow.current].map(
			(p) => `ln:${p.id}`
		)
	]);
}

/** Which of a press's packages INSTALLED still draws: the selection it leaves behind. */
function shownSelection(pkgs: readonly string[], reveal: boolean): string[] {
	const drawn = drawnPackages(installedView(reveal), pluginsShown(pluginView(reveal), reveal));
	return pkgs.filter((pkg) => drawn.has(pkg));
}

/**
 * How far each switch is along on each package: the sources of the extension
 * that have it on, out of every source it has (`browseSources(true)`), which
 * is what a mixed cell and a row's SWITCHES line are counted from. A package
 * whose sources are not known has no entry.
 *
 * Hidden means hidden: only the packages this viewer is drawn get an entry,
 * and outside reveal no hidden count is sent at all, so a hidden package and
 * the fact that a drawn one has hidden sources never reach a client outside
 * reveal. A drawn package's total still counts every source, hidden ones
 * included: the every-source rule needs it.
 */
function flagsByPackage(
	drawn: Set<string>,
	reveal: boolean
): Record<string, { total: number; on: Record<SourceFlag, number> }> {
	const grouped = packageSources();
	const out: Record<string, { total: number; on: Record<SourceFlag, number> }> = {};
	for (const pkg of drawn) {
		// A plugin is its one id even when its file failed: the switch is tsundoku's,
		// keyed by `ln:<id>`, and nothing about the plugin can stop it.
		const ids = grouped.get(pkg) ?? (pluginOf(pkg) ? [pkg] : []);
		if (ids.length === 0) continue;
		const current = sourceFlagsOf(ids);
		out[pkg] = {
			total: ids.length,
			on: Object.fromEntries(
				SOURCE_FLAGS.map((flag) => [
					flag,
					// Hidden sources are not counted outside reveal; the row itself may be.
					flag === 'hidden' && !reveal ? 0 : ids.filter((id) => current.get(id)?.[flag]).length
				])
			) as Record<SourceFlag, number>
		};
	}
	return out;
}

export const load: PageServerLoad = async ({ url, cookies }) => {
	guard();
	const reveal = isRevealed(cookies);
	const asked = url.searchParams.get('tab');
	const tab: Tab = asked === 'available' || asked === 'repos' ? asked : 'installed';
	const repos = listRepos();
	const novelRepos = listNovelRepos();
	// Extensions installed before tsundoku asked whether they use a WebView, read once (migration 78).
	await fillWebViewFlags();
	const installedNow = installedView(reveal);
	// Hidden means hidden: a plugin with HIDDEN SOURCE on, or mostly hidden, is
	// drawn and counted only inside reveal, as a package is.
	const pluginsNow = pluginsShown(pluginView(reveal), reveal);
	const drawn = drawnPackages(installedNow, pluginsNow);
	// SELECT is INSTALLED's only: its state is in the URL, and so is
	// the selection, so a no-script press lands with the rows it ticked still
	// ticked. A package that left the list leaves the selection with it.
	const select = url.searchParams.get('select') === '1';
	const ticked = listParam(url.searchParams, 'pkg').filter((p) => drawn.has(p));
	const counts = {
		installed:
			installedNow.needsHand.length +
			installedNow.updates.length +
			installedNow.current.length +
			pluginsNow.needsHand.length +
			pluginsNow.updates.length +
			pluginsNow.current.length,
		repos: repos.length + novelRepos.length
	};
	const checkedAt = [...repos, ...novelRepos].reduce<number | null>(
		(a, r) => (r.checkedAt && (!a || r.checkedAt > a) ? r.checkedAt : a),
		null
	);

	// AVAILABLE's tabs are one per source family: Mihon's APKs,
	// Aniyomi's, LNReader's plugins. The URL's word for each is unchanged
	// (none, `anime`, `novels`), and so is `kind`, which the page sends back.
	const kindAsked = url.searchParams.get('kind');
	const family: SourceFamily =
		kindAsked === 'anime' ? 'aniyomi' : kindAsked === 'novels' ? 'lnreader' : 'mihon';
	const kind: Kind | 'novels' = family === 'lnreader' ? 'novels' : SOURCE_KINDS[family];
	// AVAILABLE's filters (doc/BROWSE.md, "Filters"): in the URL, for this visit.
	const filters = parseExtFilters(url.searchParams);
	const available = availableView({
		// The plugins' tab still counts the APKs' tabs, as Mihon's would.
		kind: family === 'lnreader' ? SOURCE_KINDS.mihon : SOURCE_KINDS[family],
		q: url.searchParams.get('q') ?? '',
		filters,
		reveal
	});

	// A pasted address answers with what it holds before anything is added.
	const address = (url.searchParams.get('add') ?? '').trim();
	let preview:
		| { name: string; base: string; manga: number; anime: number; novels: number }
		| { error: string }
		| null = null;
	if (tab === 'repos' && address) {
		try {
			if (isNovelRepoAddress(address)) {
				// LNReader's: one plugins.min.json, no signing key (doc/NOVELS.md).
				const p = await previewNovelRepo(address);
				preview = { name: p.name, base: p.url, manga: 0, anime: 0, novels: p.listings.length };
			} else {
				const p = await previewRepo(address);
				preview = {
					name: p.name,
					base: p.base,
					// An APK listing is counted by its family (`familyOfKind`).
					manga: p.listings.filter((l) => familyOfKind(l.kind) === 'mihon').length,
					anime: p.listings.filter((l) => familyOfKind(l.kind) === 'aniyomi').length,
					novels: 0
				};
			}
		} catch (e) {
			preview = {
				error:
					e instanceof UntrustedError
						? 'its index is signed by another key than the repository'
						: (e as Error).message
			};
		}
	}

	const removeAsked = url.searchParams.get('remove') ?? '';
	const removingNow = removeAsked
		? pluginOf(removeAsked)
			? pluginRemoval(pluginOf(removeAsked)!, reveal)
			: removal(removeAsked, reveal)
		: null;
	const repoAsked = Number(url.searchParams.get('removeRepo'));
	const novelRepoAsked = Number(url.searchParams.get('removeNovelRepo'));
	const plugins = novelsAvailable({
		q: url.searchParams.get('q') ?? '',
		filters,
		languages: browseLanguages(),
		reveal
	});

	// SELECT's band: one at a time, each its URL, so a reload says
	// the same and UNDO posts the facts it was given.
	const band = flagsBand(url.searchParams);
	const updateBand =
		url.searchParams.get('band') === 'update'
			? {
					done: listParam(url.searchParams, 'done'),
					ver: listParam(url.searchParams, 'ver'),
					failed: listParam(url.searchParams, 'miss'),
					untrusted: listParam(url.searchParams, 'untrusted'),
					of: Number(url.searchParams.get('of')) || 0,
					noUpdate: Number(url.searchParams.get('no')) || 0
				}
			: null;
	const removeBand =
		url.searchParams.get('band') === 'remove'
			? {
					done: listParam(url.searchParams, 'done'),
					stayed: listParam(url.searchParams, 'stayed'),
					series: Number(url.searchParams.get('series')) || 0,
					queued: Number(url.searchParams.get('queued')) || 0,
					followed: Number(url.searchParams.get('followed')) || 0
				}
			: null;
	const backBand =
		url.searchParams.get('band') === 'back' ? { done: listParam(url.searchParams, 'done') } : null;

	/**
	 * REMOVE's question about a selection (the bar's REMOVE n…, `?removeSel=1`):
	 * what the removable rows would take, and which ticked rows are OBSOLETE and
	 * stay installed (no repository lists them, so once removed they could not be
	 * installed again and their settings could not be reached).
	 */
	let removingSome: {
		pkgs: string[];
		stayed: string[];
		names: string[];
		of: number;
		series: number;
		queued: number;
		followed: number;
	} | null = null;
	if (url.searchParams.get('removeSel') === '1' && ticked.length) {
		const rows = new Map(
			[...installedNow.needsHand, ...installedNow.updates, ...installedNow.current].map((r) => [
				r.pkg,
				r
			])
		);
		const prow = new Map(
			[...pluginsNow.needsHand, ...pluginsNow.updates, ...pluginsNow.current].map((p) => [
				`ln:${p.id}`,
				p
			])
		);
		const pkgs: string[] = [];
		const stayed: string[] = [];
		const names: string[] = [];
		let series = 0;
		let queued = 0;
		let followed = 0;
		for (const pkg of ticked) {
			const r = rows.get(pkg);
			const p = prow.get(pkg);
			if (!r && !p) continue;
			if (r?.obsolete || p?.obsolete) {
				stayed.push(pkg);
				continue;
			}
			const what = p ? pluginRemoval(pluginOf(pkg)!, reveal) : removal(pkg, reveal);
			if (!what) continue;
			pkgs.push(pkg);
			names.push(what.name);
			series += what.series;
			queued += what.queued;
			followed += what.followed;
		}
		removingSome = { pkgs, stayed, names, of: ticked.length, series, queued, followed };
	}
	// REMOVE's question is a GET of the bulk form, so without script it can
	// arrive with no ticks: the bar is drawn pressable on an empty selection
	// before hydration. Answer the page's refusal band rather than nothing.
	const removeRefusal =
		url.searchParams.get('removeSel') === '1' && ticked.length === 0 ? 'NOTHING TICKED' : null;

	return {
		tab,
		reveal,
		languages: browseLanguages(),
		now: Date.now(),
		counts,
		checkedAt,
		select,
		selected: ticked,
		drawn: [...drawn],
		packageFlags: tab === 'installed' ? flagsByPackage(drawn, reveal) : {},
		updates: [
			...installedNow.updates.map((r) => r.pkg),
			...pluginsNow.updates.map((p) => `ln:${p.id}`)
		],
		obsolete: [
			...[...installedNow.needsHand, ...installedNow.updates, ...installedNow.current]
				.filter((r) => r.obsolete)
				.map((r) => r.pkg),
			...[...pluginsNow.needsHand, ...pluginsNow.updates, ...pluginsNow.current]
				.filter((p) => p.obsolete)
				.map((p) => `ln:${p.id}`)
		],
		band,
		updateBand,
		removeBand,
		backBand,
		installed: tab === 'installed' ? installedNow : null,
		// NEEDS A WEBVIEW on an installed extension whose code uses one, in words
		// where this install can't give it one (doc/BROWSE.md, "Extensions that
		// need a WebView"); the page watches the browser's first download while
		// one is installed. The engine is asked only when one is.
		webviewMark:
			tab === 'installed' &&
			[...installedNow.needsHand, ...installedNow.updates, ...installedNow.current].some(
				(r) => r.webview
			)
				? await mark()
				: null,
		plugins: tab === 'installed' ? pluginsNow : null,
		available: tab === 'available' ? { ...available, kind, family } : null,
		novelsAvailable: tab === 'available' && family === 'lnreader' ? plugins : null,
		availableCounts: { ...available.counts, novels: plugins.total },
		filters,
		// REPOSITORY's choices: the extension repositories for manga and anime, LNReader's for novels.
		filterRepos: {
			engine: repos.map((r) => ({ key: `e${r.id}`, name: r.name })),
			novels: novelRepos.map((r) => ({ key: `n${r.id}`, name: r.name }))
		},
		repos: tab === 'repos' ? repos : null,
		novelRepos: tab === 'repos' ? novelRepos : null,
		address,
		preview,
		removing: removingNow ? { pkg: removeAsked, ...removingNow } : null,
		removingSome,
		removeRefusal,
		removingRepo: repoAsked ? (repos.find((r) => r.id === repoAsked) ?? null) : null,
		removingNovelRepo: novelRepoAsked
			? (novelRepos.find((r) => r.id === novelRepoAsked) ?? null)
			: null
	};
};

export const actions: Actions = {
	install: async ({ request }) => {
		guard();
		const pkg = pkgOf(await request.formData());
		// The browse world's hold (tests/browse-setup.ts): off in any build
		// the user runs, and only the post that asks for it waits.
		await holdPost('install', request);
		try {
			if (pluginOf(pkg)) await installPlugin(pluginOf(pkg)!);
			else await install(pkg);
		} catch (e) {
			return refusal(e, pkg);
		}
		return { done: pkg };
	},
	/** UPDATE is installing the version the repository lists now; the old one is kept a week. */
	update: async ({ request }) => {
		guard();
		const pkg = pkgOf(await request.formData());
		try {
			if (pluginOf(pkg)) await installPlugin(pluginOf(pkg)!);
			else await install(pkg);
		} catch (e) {
			return refusal(e, pkg);
		}
		forgetPackage(pkg);
		return { done: pkg };
	},
	/** UPDATE ALL: only what's shown, so reveal decides what it reaches. */
	updateAll: async ({ cookies }) => {
		guard();
		const failed: string[] = [];
		for (const e of installedView(isRevealed(cookies)).updates) {
			try {
				await install(e.pkg);
				forgetPackage(e.pkg);
			} catch (err) {
				warnRefused(e.pkg, err);
				failed.push(e.name);
			}
		}
		for (const p of pluginsShown(pluginView(isRevealed(cookies)), isRevealed(cookies)).updates) {
			try {
				await installPlugin(p.id);
			} catch (err) {
				warnRefused(p.id, err);
				failed.push(p.name);
			}
		}
		if (failed.length) return fail(502, { message: `${failed.join(', ')} did not update` });
		return { done: 'all' };
	},
	back: async ({ request }) => {
		guard();
		const pkg = pkgOf(await request.formData());
		const plugin = pluginOf(pkg);
		if (!(plugin ? backPlugin(plugin) : back(pkg)))
			return fail(409, { pkg, message: 'The previous version is no longer kept' });
		forgetPackage(pkg);
		return { done: pkg };
	},
	retry: async ({ request }) => {
		guard();
		const pkg = pkgOf(await request.formData());
		const plugin = pluginOf(pkg);
		if (!(await (plugin ? reloadPlugin(plugin) : loadAgain(pkg))))
			return fail(502, { pkg, message: 'It still does not load' });
		return { done: pkg };
	},
	remove: async ({ request }) => {
		guard();
		const pkg = pkgOf(await request.formData());
		const plugin = pluginOf(pkg);
		if (plugin) removePlugin(plugin);
		else removeExtension(pkg);
		redirect(303, '/browse/extensions');
	},
	/**
	 * SELECT's switches: one of tsundoku's own switches on every
	 * source of every ticked extension, in one transaction, with the band and
	 * its facts. A switch press does not end SELECT.
	 */
	flags: async ({ cookies, request, url }) => {
		guard();
		const form = await request.formData();
		// Each bar cell carries its own switch and target in the button's formaction,
		// so one form posts all six (Main 05): the action's URL says which.
		const flag = String(form.get('flag') ?? url.searchParams.get('flag') ?? '');
		const value = String(form.get('value') ?? url.searchParams.get('value') ?? '');
		if (!isSourceFlag(flag)) return fail(400, { message: 'No such switch' });
		if (value !== 'true' && value !== 'false') return fail(400, { message: 'Not on or off' });
		// The browse world's hold (tests/browse-setup.ts): off in any build
		// the user runs, and only the post that asks for it waits.
		await holdPost('flag', request);
		const reveal = isRevealed(cookies);
		// Hidden means hidden: a stale tab or a hand-made post changes only the
		// packages this viewer is drawn, as the settings page answers 404 for a
		// source it may not see. A package not installed at all still reaches the
		// press, so the band can count it `gone` rather than call it a success.
		// UNDO stays unrestricted, because HIDE outside reveal has to bring the
		// package back.
		const drawn = drawnPackages(installedView(reveal), pluginsShown(pluginView(reveal), reveal));
		const installedNow = installedPackages();
		// A no-script page is drawn with the cells pressable on an empty
		// selection (they are disabled only once hydrated), so a press with no
		// tick can arrive: refuse it with the band and write nothing. A press
		// that named only hidden packages is not empty — it is filtered below
		// and answers what every other filtered press does.
		const ticked = tickedPackages(form);
		if (!ticked.length) return fail(409, { message: 'NOTHING TICKED', selected: [] });
		const pkgs = ticked.filter((pkg) => drawn.has(pkg) || !installedNow.has(pkg));
		let plan: ReturnType<typeof planFlag>;
		try {
			plan = planFlag(pkgs, flag, value === 'true');
		} catch (e) {
			// Only the size guard is the bar's own refusal; anything else surfaces.
			if (e instanceof TooManySourcesError)
				return fail(409, { message: 'TOO MANY SOURCES TO CHANGE AT ONCE', selected: pkgs });
			throw e;
		}
		const q = bandQuery('flags', {
			flag,
			to: plan.to ? '1' : '0',
			// Outside reveal a HIDE press on a package with an already-hidden source
			// would otherwise write that source's id and its previous state into the
			// band (hidden means hidden: `flagsByPackage` sends no hidden count
			// outside reveal). The press does not change it, and UNDO must not touch
			// it, so it leaves the facts; inside reveal the count is the band's own.
			from: encodeFacts(
				!reveal && flag === 'hidden' && plan.to ? plan.facts.filter((f) => !f.previous) : plan.facts
			),
			of: plan.of,
			chg: plan.chg,
			miss: plan.miss,
			gone: plan.gone
		});
		// Refuse before the write: past Node's 16 KB request head the redirect's
		// GET is a 431, and the press would already be done with no band or UNDO.
		// The whole Location is the cost, not the band alone: `selectQuery` adds
		// one `pkg` per ticked package, which the band's own bytes never counted.
		// The selection before the write is an upper bound (a HIDE drops rows
		// after it), so this measures every package the press asked for. A
		// refusal answers with those ticks: without script the page is a fresh
		// mount on an action URL that carries none of them.
		if (!pressFits(`${PAGE}?${selectQuery(shownSelection(pkgs, reveal), q)}`))
			return fail(409, { message: 'TOO MANY SOURCES TO CHANGE AT ONCE', selected: pkgs });
		applyFlag(plan);
		const still = shownSelection(pkgs, reveal);
		redirect(303, `${PAGE}?${selectQuery(still, q)}`);
	},
	/** UNDO on a switch press: each source back as it was, whole or not at all. */
	undoFlags: async ({ cookies, request }) => {
		guard();
		const form = await request.formData();
		const flag = String(form.get('flag') ?? '');
		if (!isSourceFlag(flag)) return fail(400, { message: 'No such switch' });
		const to = String(form.get('to') ?? '') === '1';
		const facts = decodeFacts(String(form.get('from') ?? ''));
		if (!facts.length) return fail(400, { message: 'Nothing to undo' });
		const refused = undoRefusal(flag, to, facts, isRevealed(cookies));
		if (refused) return fail(409, { message: refused });
		undoFlagPress(flag, facts);
		redirect(303, `${PAGE}?${selectQuery(tickedPackages(form))}`);
	},
	/**
	 * SELECT's UPDATE: UPDATE ALL narrowed to the ticked rows, each
	 * one install as UPDATE does it, and SELECT ends however many took.
	 */
	updateSome: async ({ cookies, request }) => {
		guard();
		const form = await request.formData();
		const pkgs = tickedPackages(form);
		const reveal = isRevealed(cookies);
		const iv = installedView(reveal);
		const pv = pluginsShown(pluginView(reveal), reveal);
		const named = new Map<string, string>([
			...[...iv.needsHand, ...iv.updates, ...iv.current].map((r) => [r.pkg, r.name] as const),
			...[...pv.needsHand, ...pv.updates, ...pv.current].map((p) => [`ln:${p.id}`, p.name] as const)
		]);
		const updatable = new Set([
			...iv.updates.map((r) => r.pkg),
			...pv.updates.map((p) => `ln:${p.id}`)
		]);
		const asked = pkgs.filter((pkg) => updatable.has(pkg));
		if (asked.length === 0)
			return fail(409, { message: 'NOTHING TICKED HAS AN UPDATE', selected: pkgs });
		// Refuse before the first install, as the flags press does: every asked
		// package will be one band row. `done` is the longest path (it carries the
		// `pkg` and, since UPDATE's UNDO checks the version, the `ver` too), so
		// cost each asked package as `done` and its version together. The version
		// the press will leave is the one its repository lists; no shorter than 8
		// bytes is counted, and the 4 KB under Node's head absorbs a loader that
		// reports a longer name than its repository.
		const upcoming = new Map<string, string>([
			...iv.updates.map((r) => [r.pkg, r.update ?? ''] as const),
			...pv.updates.map((p) => [`ln:${p.id}`, p.update ?? ''] as const)
		]);
		const verCost = asked.map((pkg) => 'x'.repeat(Math.max(8, upcoming.get(pkg)?.length ?? 0)));
		if (
			!pressFits(
				`${PAGE}?${bandQuery('update', {
					done: asked,
					ver: verCost,
					of: asked.length,
					no: pkgs.length - asked.length
				})}`
			)
		)
			return fail(409, { message: 'TOO MANY SOURCES TO CHANGE AT ONCE', selected: pkgs });
		const done: string[] = [];
		/** A repository that did not answer, and a signature that did not match, said apart. */
		const failed: string[] = [];
		const untrusted: string[] = [];
		for (const pkg of asked) {
			try {
				const plugin = pluginOf(pkg);
				if (plugin) await installPlugin(plugin);
				else await install(pkg);
				forgetPackage(pkg);
				done.push(pkg);
			} catch (e) {
				if (e instanceof UntrustedError) untrusted.push(pkg);
				else failed.push(pkg);
			}
		}
		// A failed update is not a success with a smaller count: with
		// nothing taken, answer as UPDATE ALL does, and keep SELECT and its ticks.
		// A repository that did not answer and a signature that did not match are
		// named apart: one suffix for all names reported the wrong one for each.
		if (done.length === 0) {
			const namesOf = (list: string[]) => list.map((pkg) => named.get(pkg) ?? pkg).join(', ');
			const parts: string[] = [];
			if (failed.length) parts.push(`${namesOf(failed)} did not update`);
			if (untrusted.length)
				parts.push(`${namesOf(untrusted)} (signed with another key than its repository)`);
			return fail(502, { message: parts.join(' · '), selected: pkgs });
		}
		// What each updated row's version is now: UNDO carries it, so a row that
		// has gone back since (its own BACK TO) cannot be swapped forward again.
		const versions = new Map<string, string>();
		for (const e of installed()) versions.set(e.pkg, e.versionName);
		for (const p of installedPlugins()) versions.set(`ln:${p.id}`, p.version);
		redirect(
			303,
			`${PAGE}?${bandQuery('update', {
				done,
				ver: done.map((pkg) => versions.get(pkg) ?? ''),
				miss: failed,
				untrusted,
				of: asked.length,
				no: pkgs.length - asked.length
			})}`
		);
	},
	/** UNDO on a bulk UPDATE: BACK TO for every row it updated, and only when every one can. */
	undoUpdate: async ({ cookies, request }) => {
		guard();
		const form = await request.formData();
		const pkgs = tickedPackages(form);
		const vers = form.getAll('ver').map(String);
		const reveal = isRevealed(cookies);
		// The version each row is now: the band carried the one the press
		// installed, so a row that changed since (its own BACK TO, an update from
		// another tab) refuses the whole UNDO instead of being swapped forward
		// and reported as restored. Raw stores, not the drawn view: a row hidden
		// since is still checked, and nothing here is named.
		const current = new Map<string, string>();
		for (const e of installed()) current.set(e.pkg, e.versionName);
		for (const p of installedPlugins()) current.set(`ln:${p.id}`, p.version);
		const changed = pkgs.findIndex((pkg, i) => !vers[i] || current.get(pkg) !== vers[i]);
		if (!pkgs.length || vers.length !== pkgs.length || changed !== -1)
			return fail(409, {
				message: 'UNDO REFUSED · A ROW CHANGED SINCE THE UPDATE · NOTHING CHANGED'
			});
		const iv = installedView(reveal);
		const pv = pluginsShown(pluginView(reveal), reveal);
		const backable = new Set([
			...[...iv.needsHand, ...iv.updates, ...iv.current].filter((r) => r.backTo).map((r) => r.pkg),
			...[...pv.needsHand, ...pv.updates, ...pv.current]
				.filter((p) => p.backTo)
				.map((p) => `ln:${p.id}`)
		]);
		if (pkgs.some((pkg) => !backable.has(pkg)))
			return fail(409, { message: 'THE VERSION BEFORE IS NO LONGER KEPT · NOTHING CHANGED' });
		// Count only what BACK TO actually took: a row can lose its kept version
		// between the check above and the write.
		const done: string[] = [];
		for (const pkg of pkgs) {
			const plugin = pluginOf(pkg);
			const back_ = plugin ? backPlugin(plugin) : back(pkg);
			if (!back_) continue;
			forgetPackage(pkg);
			done.push(pkg);
		}
		redirect(303, `${PAGE}?${bandQuery('back', { done })}`);
	},
	/**
	 * REMOVE for a selection. The sheet asked first, so there is no
	 * UNDO; an OBSOLETE row stays installed, because no repository lists it any
	 * more and its settings could not be reached again.
	 */
	removeSome: async ({ cookies, request }) => {
		guard();
		const form = await request.formData();
		const reveal = isRevealed(cookies);
		const asked = tickedPackages(form);
		if (!asked.length) return fail(409, { message: 'NOTHING TICKED', selected: [] });
		// Refuse before the first removal, as the flags press does: every asked
		// package will be one band row, and `stayed` is the longer of its two
		// list keys, so it is the upper bound on what the redirect sends.
		if (
			!pressFits(
				`${PAGE}?${bandQuery('remove', { stayed: asked, series: 0, queued: 0, followed: 0 })}`
			)
		)
			return fail(409, { message: 'TOO MANY SOURCES TO CHANGE AT ONCE', selected: asked });
		const iv = installedView(reveal);
		const pv = pluginsShown(pluginView(reveal), reveal);
		const known = new Set([
			...[...iv.needsHand, ...iv.updates, ...iv.current].map((r) => r.pkg),
			...[...pv.needsHand, ...pv.updates, ...pv.current].map((p) => `ln:${p.id}`)
		]);
		const done: string[] = [];
		const stayed: string[] = [];
		let series = 0;
		let queued = 0;
		let followed = 0;
		for (const pkg of asked) {
			if (!known.has(pkg)) continue;
			const plugin = pluginOf(pkg);
			const obsolete = plugin
				? !!installedPlugins().find((p) => p.id === plugin)?.obsolete
				: findListing(pkg, getDb()) === null;
			if (obsolete) {
				stayed.push(pkg);
				continue;
			}
			const what = plugin ? pluginRemoval(plugin, reveal) : removal(pkg, reveal);
			if (!what) continue;
			series += what.series;
			queued += what.queued;
			followed += what.followed;
			if (plugin) removePlugin(plugin);
			else removeExtension(pkg);
			done.push(pkg);
		}
		redirect(303, `${PAGE}?${bandQuery('remove', { done, stayed, series, queued, followed })}`);
	},
	addRepo: async ({ request }) => {
		guard();
		const address = String((await request.formData()).get('address') ?? '').trim();
		try {
			if (isNovelRepoAddress(address)) await addNovelRepo(address);
			else await addRepo(address);
		} catch (e) {
			return refusal(e, '', `repository ${address}`);
		}
		redirect(303, '/browse/extensions?tab=repos');
	},
	removeRepo: async ({ request }) => {
		guard();
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (Number.isInteger(id)) {
			if (form.get('kind') === 'novels') removeNovelRepo(id);
			else removeRepo(id);
		}
		redirect(303, '/browse/extensions?tab=repos');
	},
	/** CHECK NOW: every repository read again; one that stopped answering keeps its row. */
	check: async () => {
		guard();
		for (const r of listRepos()) await refreshRepo(r.id);
		for (const r of listNovelRepos()) await refreshNovelRepo(r.id);
		return { done: 'check' };
	}
};
