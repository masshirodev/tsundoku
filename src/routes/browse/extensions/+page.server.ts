import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { parseExtFilters } from '$lib/library/ext-filters';
import { isRevealed } from '$lib/server/prefs';
import { downloadsBackend } from '$lib/server/engine/run';
import { familyOfKind, RepoError } from '$lib/server/engine/repo-index';
import {
	addRepo,
	back,
	findListing,
	install,
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
	bandQuery,
	decodeFacts,
	encodeFacts,
	flagsBand,
	installedPackages,
	listOf,
	packageSources,
	pluginOf,
	pressFlag,
	selectQuery,
	tickedPackages,
	undoFlagPress,
	undoRefusal
} from './select.server';

/**
 * EXTENSIONS, BROWSE's back room (Index-Extensions: installed, remove,
 * available, availableReveal, repos, notRepo; doc/BROWSE.md, "Extensions and
 * repositories"; card c144). Three tabs in the URL (`tab`), and every action
 * a form post, so it all works without script. Nothing updates by itself:
 * UPDATE and UPDATE ALL ask, and BACK TO undoes an update for a week.
 */

type Tab = 'installed' | 'available' | 'repos';

const PAGE = '/browse/extensions';

function guard() {
	if (downloadsBackend() !== 'engine') error(404, 'not found');
}

/** An extension's package, or an LNReader plugin as `ln:<id>` (doc/NOVELS.md, c148). */
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
function refusal(e: unknown, pkg = '') {
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

/** The packages INSTALLED draws now, as the selection may hold them (c696). */
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
 */
function flagsByPackage(): Record<string, { total: number; on: Record<SourceFlag, number> }> {
	const grouped = packageSources();
	const out: Record<string, { total: number; on: Record<SourceFlag, number> }> = {};
	for (const [pkg, ids] of grouped) {
		if (ids.length === 0) continue;
		const current = sourceFlagsOf(ids);
		out[pkg] = {
			total: ids.length,
			on: Object.fromEntries(
				SOURCE_FLAGS.map((flag) => [flag, ids.filter((id) => current.get(id)?.[flag]).length])
			) as Record<SourceFlag, number>
		};
	}
	// A plugin is its one id even when its file failed: the switch is tsundoku's,
	// keyed by `ln:<id>`, and nothing about the plugin can stop it.
	for (const pkg of installedPackages())
		if (!out[pkg] && pluginOf(pkg)) {
			const current = sourceFlagsOf([pkg]);
			out[pkg] = {
				total: 1,
				on: Object.fromEntries(
					SOURCE_FLAGS.map((flag) => [flag, current.get(pkg)?.[flag] ? 1 : 0])
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
	const installedNow = installedView(reveal);
	// Hidden means hidden: a plugin with HIDDEN SOURCE on, or mostly hidden, is
	// drawn and counted only inside reveal, as a package is (card c435).
	const pluginsNow = pluginsShown(pluginView(reveal), reveal);
	const drawn = drawnPackages(installedNow, pluginsNow);
	// SELECT (card c696) is INSTALLED's only: its state is in the URL, and so is
	// the selection, so a no-script press lands with the rows it ticked still
	// ticked. A package that left the list leaves the selection with it.
	const select = url.searchParams.get('select') === '1';
	const ticked = listOf(url.searchParams.getAll('pkg').join(',')).filter((p) => drawn.has(p));
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

	// AVAILABLE's tabs are one per source family (card c303): Mihon's APKs,
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
					// An APK listing is counted by its family (`familyOfKind`; card c420).
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

	// SELECT's band (card c696): one at a time, each its URL, so a reload says
	// the same and UNDO posts the facts it was given.
	const band = flagsBand(url.searchParams);
	const updateBand =
		url.searchParams.get('band') === 'update'
			? {
					done: listOf(url.searchParams.get('done')),
					failed: listOf(url.searchParams.get('miss')),
					of: Number(url.searchParams.get('of')) || 0,
					noUpdate: Number(url.searchParams.get('no')) || 0
				}
			: null;
	const removeBand =
		url.searchParams.get('band') === 'remove'
			? {
					done: listOf(url.searchParams.get('done')),
					stayed: listOf(url.searchParams.get('stayed')),
					series: Number(url.searchParams.get('series')) || 0,
					queued: Number(url.searchParams.get('queued')) || 0,
					followed: Number(url.searchParams.get('followed')) || 0
				}
			: null;
	const backBand =
		url.searchParams.get('band') === 'back' ? { done: listOf(url.searchParams.get('done')) } : null;

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
		packageFlags: tab === 'installed' ? flagsByPackage() : {},
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
		// The browse world's hold (tests/browse-setup.ts, c636): off in any build
		// the owner runs, and only the post that asks for it waits.
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
			} catch {
				failed.push(e.name);
			}
		}
		for (const p of pluginsShown(pluginView(isRevealed(cookies)), isRevealed(cookies)).updates) {
			try {
				await installPlugin(p.id);
			} catch {
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
	 * SELECT's switches (card c696): one of tsundoku's own switches on every
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
		// The browse world's hold (tests/browse-setup.ts, c636): off in any build
		// the owner runs, and only the post that asks for it waits.
		await holdPost('flag', request);
		const pkgs = tickedPackages(form);
		let press: ReturnType<typeof pressFlag>;
		try {
			press = pressFlag(pkgs, flag, value === 'true');
		} catch {
			return fail(409, { message: 'TOO MANY SOURCES TO CHANGE AT ONCE' });
		}
		const reveal = isRevealed(cookies);
		const still = shownSelection(pkgs, reveal);
		const q = bandQuery('flags', {
			flag,
			to: press.to ? '1' : '0',
			from: encodeFacts(press.facts),
			of: press.of,
			chg: press.chg,
			miss: press.miss,
			gone: press.gone
		});
		redirect(303, `${PAGE}?${selectQuery(still, q)}`);
	},
	/** UNDO on a switch press: each source back as it was, whole or not at all. */
	undoFlags: async ({ request }) => {
		guard();
		const form = await request.formData();
		const flag = String(form.get('flag') ?? '');
		if (!isSourceFlag(flag)) return fail(400, { message: 'No such switch' });
		const to = String(form.get('to') ?? '') === '1';
		const facts = decodeFacts(String(form.get('from') ?? ''));
		if (!facts.length) return fail(400, { message: 'Nothing to undo' });
		const refused = undoRefusal(flag, to, facts);
		if (refused) return fail(409, { message: refused });
		undoFlagPress(flag, facts);
		redirect(303, `${PAGE}?${selectQuery(tickedPackages(form))}`);
	},
	/**
	 * SELECT's UPDATE (card c696): UPDATE ALL narrowed to the ticked rows, each
	 * one install as UPDATE does it, and SELECT ends however many took.
	 */
	updateSome: async ({ cookies, request }) => {
		guard();
		const form = await request.formData();
		const pkgs = tickedPackages(form);
		const reveal = isRevealed(cookies);
		const iv = installedView(reveal);
		const pv = pluginsShown(pluginView(reveal), reveal);
		const updatable = new Set([
			...iv.updates.map((r) => r.pkg),
			...pv.updates.map((p) => `ln:${p.id}`)
		]);
		const asked = pkgs.filter((pkg) => updatable.has(pkg));
		if (asked.length === 0) return fail(409, { message: 'NOTHING TICKED HAS AN UPDATE' });
		const done: string[] = [];
		const failed: string[] = [];
		for (const pkg of asked) {
			try {
				const plugin = pluginOf(pkg);
				if (plugin) await installPlugin(plugin);
				else await install(pkg);
				forgetPackage(pkg);
				done.push(pkg);
			} catch {
				failed.push(pkg);
			}
		}
		redirect(
			303,
			`${PAGE}?${bandQuery('update', {
				done,
				miss: failed,
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
		const reveal = isRevealed(cookies);
		const iv = installedView(reveal);
		const pv = pluginsShown(pluginView(reveal), reveal);
		const backable = new Set([
			...[...iv.needsHand, ...iv.updates, ...iv.current].filter((r) => r.backTo).map((r) => r.pkg),
			...[...pv.needsHand, ...pv.updates, ...pv.current]
				.filter((p) => p.backTo)
				.map((p) => `ln:${p.id}`)
		]);
		if (!pkgs.length || pkgs.some((pkg) => !backable.has(pkg)))
			return fail(409, { message: 'THE VERSION BEFORE IS NO LONGER KEPT · NOTHING CHANGED' });
		for (const pkg of pkgs) {
			const plugin = pluginOf(pkg);
			if (plugin) backPlugin(plugin);
			else back(pkg);
			forgetPackage(pkg);
		}
		redirect(303, `${PAGE}?${bandQuery('back', { done: pkgs })}`);
	},
	/**
	 * REMOVE for a selection (card c696). The sheet asked first, so there is no
	 * UNDO; an OBSOLETE row stays installed, because no repository lists it any
	 * more and its settings could not be reached again.
	 */
	removeSome: async ({ cookies, request }) => {
		guard();
		const form = await request.formData();
		const reveal = isRevealed(cookies);
		const asked = tickedPackages(form);
		if (!asked.length) return fail(400, { message: 'Nothing to remove' });
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
			return refusal(e);
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
