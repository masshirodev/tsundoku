import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { isRevealed } from '$lib/server/prefs';
import { setSetting } from '$lib/server/settings';
import {
	SuwayomiError,
	arrivedSince,
	configured,
	dequeue,
	notAnsweringSince,
	pausedAt,
	queue,
	retry,
	seriesForKey,
	setPaused,
	toTheTop
} from '$lib/server/suwayomi';
import { queueView, type QueueView } from '$lib/library/downloads';

/**
 * The download queue (Index Downloads 8–9, 12; doc/DOWNLOADING.md): what's
 * downloading, failures first, then series in Suwayomi's order. Hidden means
 * hidden, here as everywhere: queueView() leaves out what reveal would hide,
 * and every action below acts only on what the viewer can see.
 */

/** How many series are listed before "+ N MORE SERIES". */
const SHOWN = 20;
/** How many of an opened series' chapters are listed. */
const OPENED = 4;

export const load: PageServerLoad = async ({ cookies, url }) => {
	if (!configured()) error(404, 'not found');
	const reveal = isRevealed(cookies);
	const now = Date.now();
	const recent = {
		hour: arrivedSince(now - 3_600_000, reveal),
		day: arrivedSince(now - 86_400_000, reveal)
	};
	let q;
	try {
		q = await queue();
	} catch {
		return { down: { since: notAnsweringSince() ?? now }, recent, view: null };
	}
	// Resumed from Suwayomi's own UI: its pause is over here too.
	if (q.running && pausedAt() !== null) setSetting('downloads_paused_at', '');
	const v = queueView(q.items, seriesForKey, reveal);
	const open = Number(url.searchParams.get('open')) || null;
	const all = url.searchParams.get('more') === '1';
	return {
		down: null,
		recent,
		view: {
			running: q.running,
			pausedAt: q.running ? null : pausedAt(),
			queued: v.queued,
			downloading: v.downloading && {
				title: v.downloading.series?.title ?? v.downloading.mangaTitle,
				number: v.downloading.number,
				progress: v.downloading.progress,
				pages: v.downloading.pageCount
			},
			failures: v.failures.map((f) => ({
				chapterId: f.chapterId,
				title: f.series?.title ?? f.mangaTitle,
				name: f.name,
				number: f.number,
				tries: f.tries
			})),
			groups: (all ? v.groups : v.groups.slice(0, SHOWN)).map((g) => ({
				mangaId: g.mangaId,
				series: g.series,
				title: g.title,
				count: g.count,
				span: g.span,
				active: g.active,
				open: g.mangaId === open,
				chapters:
					g.mangaId === open
						? g.chapters.slice(0, OPENED).map((c) => ({ number: c.number, name: c.name }))
						: []
			})),
			more: all ? 0 : Math.max(0, v.groups.length - SHOWN),
			series: v.groups.length
		}
	};
};

/** The queue as the viewer may act on it, asked again: never a cached copy. */
async function visible(cookies: Parameters<Actions[string]>[0]['cookies']): Promise<QueueView> {
	const q = await queue();
	return queueView(q.items, seriesForKey, isRevealed(cookies));
}

const ids = (form: FormData, name: string) =>
	form
		.getAll(name)
		.map(Number)
		.filter((n) => Number.isInteger(n) && n > 0);

/** Every action: Suwayomi not answering is a refusal the page bands, not an error page. */
async function guarded<T>(fn: () => Promise<T>) {
	try {
		return await fn();
	} catch (e) {
		if (e instanceof SuwayomiError) return fail(503, { message: 'Suwayomi is not answering' });
		throw e;
	}
}

export const actions: Actions = {
	pause: async () => guarded(async () => (await setPaused(true), { ok: true })),
	resume: async () => guarded(async () => (await setPaused(false), { ok: true })),

	/** RETRY on one failure, or RETRY ALL. */
	retry: async ({ request, cookies }) =>
		guarded(async () => {
			const form = await request.formData();
			const v = await visible(cookies);
			const wanted = new Set(ids(form, 'chapter'));
			const all = form.get('all') === '1';
			await retry(v.failures.filter((f) => all || wanted.has(f.chapterId)).map((f) => f.chapterId));
			return { ok: true };
		}),

	/** ✕ on a failure: it leaves the queue, and the chapter stays NOT DOWNLOADED. */
	drop: async ({ request, cookies }) =>
		guarded(async () => {
			const wanted = new Set(ids(await request.formData(), 'chapter'));
			const v = await visible(cookies);
			await dequeue(v.failures.filter((f) => wanted.has(f.chapterId)).map((f) => f.chapterId));
			return { ok: true };
		}),

	/** CANCEL N: a series' chapters out of the queue. */
	cancel: async ({ request, cookies }) =>
		guarded(async () => {
			const manga = Number((await request.formData()).get('manga'));
			const g = (await visible(cookies)).groups.find((x) => x.mangaId === manga);
			if (!g) return fail(404, { message: 'that series is not in the queue' });
			await dequeue(g.chapters.map((c) => c.chapterId));
			return { ok: true };
		}),

	/** ↑ TO THE TOP: a series ahead of the rest, its chapters in their own order. */
	top: async ({ request, cookies }) =>
		guarded(async () => {
			const manga = Number((await request.formData()).get('manga'));
			const g = (await visible(cookies)).groups.find((x) => x.mangaId === manga);
			if (!g) return fail(404, { message: 'that series is not in the queue' });
			await toTheTop(g.chapters.map((c) => c.chapterId));
			return { ok: true };
		})
};
