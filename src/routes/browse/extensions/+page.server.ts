import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { isRevealed } from '$lib/server/prefs';
import { downloadsBackend } from '$lib/server/engine/run';
import { RepoError } from '$lib/server/engine/repo-index';
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
	removal,
	removeExtension
} from '$lib/server/engine/manage';
import { browseLanguages, browseSources, forgetSource } from '$lib/server/engine/browse';
import type { Kind } from '$lib/server/engine/repo-index';

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

const pkgOf = (form: FormData) => {
	const pkg = String(form.get('pkg') ?? '');
	if (!/^[A-Za-z0-9._-]{1,200}$/.test(pkg)) error(400, 'no such extension');
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
	if (e instanceof RepoError) return fail(502, { pkg, message: e.message });
	return fail(502, { pkg, message: (e as Error).message || 'failed' });
}

export const load: PageServerLoad = async ({ url, cookies }) => {
	guard();
	const reveal = isRevealed(cookies);
	const asked = url.searchParams.get('tab');
	const tab: Tab = asked === 'available' || asked === 'repos' ? asked : 'installed';
	const repos = listRepos();
	const installedNow = installedView(reveal);
	const counts = {
		installed:
			installedNow.needsHand.length + installedNow.updates.length + installedNow.current.length,
		repos: repos.length
	};
	const checkedAt = repos.reduce<number | null>(
		(a, r) => (r.checkedAt && (!a || r.checkedAt > a) ? r.checkedAt : a),
		null
	);

	const kind: Kind = url.searchParams.get('kind') === 'anime' ? 'anime' : 'manga';
	const adultAsked = url.searchParams.get('adult');
	const available = availableView({
		kind,
		q: url.searchParams.get('q') ?? '',
		all: url.searchParams.get('all') === '1',
		adult: adultAsked === 'only' || adultAsked === 'none' ? adultAsked : 'any',
		reveal
	});

	// A pasted address answers with what it holds before anything is added.
	const address = (url.searchParams.get('add') ?? '').trim();
	let preview:
		{ name: string; base: string; manga: number; anime: number } | { error: string } | null = null;
	if (tab === 'repos' && address) {
		try {
			const p = await previewRepo(address);
			preview = {
				name: p.name,
				base: p.base,
				manga: p.listings.filter((l) => l.kind === 'manga').length,
				anime: p.listings.filter((l) => l.kind === 'anime').length
			};
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
	const removingNow = removeAsked ? removal(removeAsked, reveal) : null;
	const repoAsked = Number(url.searchParams.get('removeRepo'));
	return {
		tab,
		reveal,
		languages: browseLanguages(),
		now: Date.now(),
		counts,
		checkedAt,
		installed: tab === 'installed' ? installedNow : null,
		available: tab === 'available' ? { ...available, kind } : null,
		availableCounts: available.counts,
		repos: tab === 'repos' ? repos : null,
		address,
		preview,
		removing: removingNow ? { pkg: removeAsked, ...removingNow } : null,
		removingRepo: repoAsked ? (repos.find((r) => r.id === repoAsked) ?? null) : null
	};
};

export const actions: Actions = {
	install: async ({ request }) => {
		guard();
		const pkg = pkgOf(await request.formData());
		try {
			await install(pkg);
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
			await install(pkg);
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
		if (failed.length) return fail(502, { message: `${failed.join(', ')} did not update` });
		return { done: 'all' };
	},
	back: async ({ request }) => {
		guard();
		const pkg = pkgOf(await request.formData());
		if (!back(pkg)) return fail(409, { pkg, message: 'The previous version is no longer kept' });
		forgetPackage(pkg);
		return { done: pkg };
	},
	retry: async ({ request }) => {
		guard();
		const pkg = pkgOf(await request.formData());
		if (!(await loadAgain(pkg))) return fail(502, { pkg, message: 'It still does not load' });
		return { done: pkg };
	},
	remove: async ({ request }) => {
		guard();
		const pkg = pkgOf(await request.formData());
		removeExtension(pkg);
		redirect(303, '/browse/extensions');
	},
	addRepo: async ({ request }) => {
		guard();
		const address = String((await request.formData()).get('address') ?? '').trim();
		try {
			await addRepo(address);
		} catch (e) {
			return refusal(e);
		}
		redirect(303, '/browse/extensions?tab=repos');
	},
	removeRepo: async ({ request }) => {
		guard();
		const id = Number((await request.formData()).get('id'));
		if (Number.isInteger(id)) removeRepo(id);
		redirect(303, '/browse/extensions?tab=repos');
	},
	/** CHECK NOW: every repository read again; one that stopped answering keeps its row. */
	check: async () => {
		guard();
		for (const r of listRepos()) await refreshRepo(r.id);
		return { done: 'check' };
	}
};
