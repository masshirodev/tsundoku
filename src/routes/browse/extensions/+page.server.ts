import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { parseExtFilters } from '$lib/library/ext-filters';
import { isRevealed } from '$lib/server/prefs';
import { downloadsBackend } from '$lib/server/engine/run';
import { familyOfKind, RepoError } from '$lib/server/engine/repo-index';
import {
	addRepo,
	back,
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

/**
 * EXTENSIONS, BROWSE's back room (Index-Extensions: installed, remove,
 * available, availableReveal, repos, notRepo; doc/BROWSE.md, "Extensions and
 * repositories"; card c144). Three tabs in the URL (`tab`), and every action
 * a form post, so it all works without script. Nothing updates by itself:
 * UPDATE and UPDATE ALL ask, and BACK TO undoes an update for a week.
 */

type Tab = 'installed' | 'available' | 'repos';

function guard() {
	if (downloadsBackend() !== 'engine') error(404, 'not found');
}

/** An extension's package, or an LNReader plugin as `ln:<id>` (doc/NOVELS.md, c148). */
const pkgOf = (form: FormData) => {
	const pkg = String(form.get('pkg') ?? '');
	if (!/^(ln:)?[A-Za-z0-9._-]{1,200}$/.test(pkg)) error(400, 'no such extension');
	return pkg;
};
const pluginOf = (pkg: string) => (pkg.startsWith('ln:') ? pkg.slice(3) : null);

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
	return {
		tab,
		reveal,
		languages: browseLanguages(),
		now: Date.now(),
		counts,
		checkedAt,
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
