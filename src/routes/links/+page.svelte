<script lang="ts">
	import { goto, invalidate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { coverSrc } from '$lib/library/links';
	import { coverPlaceholder, hueFor } from '$lib/library/cover';
	import {
		anilistUrl,
		candidateKind,
		isExact,
		matchTitles,
		parsePasted
	} from '$lib/library/catalogue';
	import { langName, parseRanobeUrl } from '$lib/library/ranobe';
	import { seasonTag } from '$lib/library/anime';
	import { SvelteMap } from 'svelte/reactivity';
	import { offline } from '$lib/offline.svelte';
	import type { QueuedFrom, ReviewCandidate } from '$lib/server/catalogue';
	import type { RanobeReviewCandidate, Sibling } from '$lib/server/ranobe-review';
	import type { RefusedPick, RelationOffer, SeasonUndoFacts } from '$lib/server/season-links';

	/**
	 * The link review (Link Review, Ranobe Review; doc/LINKS.md,
	 * doc/RANOBE.md): one series at a time, the candidates a catalogue found
	 * for it, none of them for certain. Nothing is preselected: a match under
	 * another title is the owner's to judge, so a tap chooses one and LINK
	 * makes it. Each decision is carried out at once; UNDO takes the last one
	 * back.
	 *
	 * An item is AniList's or Ranobe's. A novel unsure on both comes up twice,
	 * Ranobe first. Ranobe's LINK may offer the same work to the series with
	 * the same title before a volume number (1b).
	 *
	 * `?series=` is one series only (FIND or CHANGE on its screen): deciding
	 * goes back to it.
	 */
	let { data } = $props();

	type Item = (typeof data.items)[number];
	/** One season of an anime (c240), when FIND opened the page on one. */
	// A partial LINK N SEASONS redraws it from the workstation's answer (c465).
	// svelte-ignore state_referenced_locally
	let season = $state(data.season);
	/** The rest of the show, from the entry just linked: ticked where the counts agree. */
	// svelte-ignore state_referenced_locally
	let relations = $state<RelationOffer[] | null>(data.relations ?? null);
	// svelte-ignore state_referenced_locally
	let pickedSeasons = $state<number[]>(ticked(data.relations ?? []));
	/**
	 * Whether the offer on screen follows a LINK made on this page, rather than
	 * coming with the page's load (EDIT on a linked season, round 3). Only then
	 * is the season's decision made, so only then does NOT NOW leave.
	 */
	let offerFromLink = $state(false);
	/**
	 * The seasons the relations tick, each once: a split season's two parts
	 * are both ticked and are one season (c418, round 2), so the count, the
	 * button and the band never say two for it.
	 */
	function ticked(offers: RelationOffer[]): number[] {
		return [...new Set(offers.filter((o) => o.ticked).map((o) => o.season))];
	}
	type Service = Item['service'];
	type Cand = ReviewCandidate | RanobeReviewCandidate;
	const SERVICE_NAME: Record<Service, string> = { anilist: 'ANILIST', ranobe: 'RANOBE' };

	/** An item's place in the queue: a novel can be in it once per catalogue. */
	// An anime's item is one season's (c352), so its season is part of its place.
	const qk = (i: { service: Service; seriesId: number; season?: number }) =>
		`${i.service}:${i.seriesId}${i.season !== undefined ? `:${i.season}` : ''}`;
	/** "SEASON 2 · ", for a band about a decision on one season of an anime; '' otherwise. */
	const seasonWord = (on: { no: number } | null) => (on ? `SEASON ${on.no} · ` : '');
	const keyOf = (c: Cand) => ('work' in c ? c.work : String(c.anilistId));
	const hrefOf = (c: Cand) =>
		'href' in c
			? c.href
			: anilistUrl(c.anilistId, candidateKind(c) === 'anime' ? 'anime' : 'manga');

	// svelte-ignore state_referenced_locally
	const byKey = new SvelteMap(data.items.map((i) => [qk(i), i]));
	// svelte-ignore state_referenced_locally
	const total = data.items.length;
	// svelte-ignore state_referenced_locally
	let single = $state(data.single);
	// The queue is this visit's: SKIP sends a series to the back of it.
	// svelte-ignore state_referenced_locally
	let queue = $state<string[]>(data.items.map(qk));
	let done = $state(0);
	let busy = $state(false);
	let failed = $state<string | null>(null);
	/** The workstation answered that the catalogue couldn't be reached (Link Review 1g). */
	let nonet = $state<Service | null>(null);

	type UndoKind = 'link' | 'none' | 'search' | 'many' | 'suggest' | 'seasons';
	type Undo = {
		title: string;
		detail: string;
		/** What the workstation is asked to take back; null: nothing to take back (SKIP). */
		undo: {
			kind: UndoKind;
			service: Service;
			series: number;
			/** An anime's season and part it acted on (c240): UNDO takes that one back. */
			season?: number;
			part?: number;
			was?: QueuedFrom;
			many?: number[];
			/** LINK N SEASONS' UNDO: the seasons the post wrote, as they stood (c595). */
			facts?: SeasonUndoFacts;
		} | null;
		before: { queue: string[]; done: number };
		/** A search's UNDO: the series as it was before, candidates and all. */
		restore?: Item;
		/** LINK N MORE's UNDO: the siblings as they were drawn. */
		restoreMany?: Item[];
	};
	let undo = $state<Undo | null>(null);

	const item = $derived<Item | null>(queue.length ? (byKey.get(queue[0]) ?? null) : null);
	/**
	 * The season a decision is about (c240): the page's own on `?series=`, or
	 * the one the queue's item is for -- the queue holds an anime an item a
	 * season (c352). Posted with LINK, NONE OF THESE, SKIP, SEARCH AGAIN and
	 * their UNDO, so the workstation never falls back to a default season.
	 */
	const at = $derived<{ no: number; part: number } | null>(
		season
			? { no: season.no, part: season.part }
			: item && 'season' in item && item.season !== undefined
				? { no: item.season, part: item.part ?? 1 }
				: null
	);
	/**
	 * The season the screen names (c240): the page's own on `?series=`, or a
	 * queue item's, from season 1 up. Season 0 is a flat list, the whole run,
	 * so it names none, on the page's own season as on a queue item's (c423:
	 * Ranma ½ (2024)'s LINK read `LINK A TO SEASON 0`); it still posts its
	 * season (`at`), which is the whole show's row.
	 */
	const named = $derived<{ no: number } | null>(
		season && season.no > 0 ? { no: season.no } : !season && at && at.no > 0 ? at : null
	);
	/**
	 * Whether a season's LINK stays on the page for the rest of the show: only
	 * when there is a rest. A show with one season (a flat list, or one
	 * numbered season) has none to offer, so its LINK goes back to the series
	 * as a comic's does, and the new link shows on the LINK row (c423: a LINK
	 * that worked looked like it hadn't, the item still on screen).
	 */
	const staysForTheRest = $derived(!!season && season.of > 1);
	/**
	 * The season's second part by hand (c350, `&part=2`, opened by `+ A SECOND
	 * PART`): where it starts and part 1's entry. Its LINK, UNLINK and their
	 * UNDO act on part 2, and it goes back to the series.
	 */
	const second = $derived(season?.part === 2 && season.second ? season.second : null);
	/**
	 * `FROM EP. n`, filled from part 1's count (the design's `FROM EP. 13`). The
	 * schema keeps no start for a part (part 2 begins after part 1's count), so
	 * another `n` is refused here and at the workstation, saying where it starts.
	 */
	// svelte-ignore state_referenced_locally
	let fromEp = $state(String(data.season?.second?.from ?? ''));
	const fromWhy = $derived(
		second && Number(fromEp.trim()) !== second.from
			? `PART 2 STARTS WHERE PART 1’S ${second.after} EPISODES END · FROM EP. ${second.from}`
			: null
	);
	/** `+ A SECOND PART` (c350): under a linked season whose part 1 leaves episodes over. */
	const addSecond = $derived(
		!!season &&
			season.part === 1 &&
			!!single?.linked &&
			!!season.second &&
			!season.second.linked &&
			!!item
	);
	const secondHref = $derived(
		item && season ? `${resolve('/links')}?series=${item.seriesId}&season=${season.no}&part=2` : ''
	);
	const ranobe = $derived(item?.service === 'ranobe');
	const name = $derived(item ? SERVICE_NAME[item.service] : '');
	let chosen = $state<string | null>(null);
	let searching = $state(false);
	let pasting = $state(false);
	let query = $state('');
	let pasteText = $state('');
	let pasted = $state<Cand | null>(null);
	let pasteNote = $state<string | null>(null);
	/** A pasted entry another season holds (c418): said so, and LINK stays dimmed. */
	let pastedHeld = $state<string | null>(null);

	/** THE SAME WORK FOR THESE? (1b): after a Ranobe LINK, until decided. */
	let sibs = $state<{
		work: string;
		title: string;
		series: number;
		rows: Sibling[];
		picked: number[];
	} | null>(null);

	// A new series starts clean: nothing chosen, the panels shut.
	let shown = $state<string | null>(null);
	$effect.pre(() => {
		const k = item ? qk(item) : null;
		if (k === shown) return;
		shown = k;
		chosen = null;
		pasted = null;
		pastedHeld = null;
		pasteText = '';
		pasteNote = null;
		searching = false;
		pasting = data.paste && k !== null;
		query = item ? editedTitle(item) : '';
	});

	/** SEARCH AGAIN's field starts from the title, with a "..." Mihon cut it to taken off. */
	function editedTitle(i: Item): string {
		return i.cutShort ? i.title.replace(/\s*(\.\.\.|…)$/, '') : i.query;
	}

	const off = $derived(!offline.online);
	/** Hidden series are never searched (Series Link 1s): only a pasted link. */
	const noSearch = $derived(!!single?.hidden);
	const cands = $derived<Cand[]>(
		pasted ? [pasted] : ((item?.candidates as Cand[] | undefined) ?? [])
	);
	const letter = (i: number) =>
		String.fromCharCode(65 + (pasted ? (item?.candidates.length ?? 0) : i));
	const selected = $derived(cands.find((c) => keyOf(c) === chosen) ?? null);
	const selectedLetter = $derived(
		selected ? letter(cands.findIndex((c) => keyOf(c) === chosen)) : ''
	);

	// ---- the workstation -------------------------------------------------------------------
	const API: Record<Service, string> = {
		anilist: resolve('/api/links'),
		ranobe: resolve('/api/links/ranobe')
	};
	async function post(service: Service, body: object): Promise<Response | null> {
		try {
			return await fetch(API[service], {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
		} catch {
			return null;
		}
	}
	const NO_ANSWER = 'THE WORKSTATION DID NOT ANSWER · NOTHING CHANGED';
	/** Why a decision didn't happen: the catalogue unreachable, refusing, or no answer at all. */
	const failText = (r: Response | null, service: Service, what = 'NOTHING CHANGED') =>
		r?.status === 503
			? `${SERVICE_NAME[service]} DID NOT ANSWER · ${what}`
			: r?.status === 422
				? `${SERVICE_NAME[service]} REFUSED IT · ${what}`
				: r?.status === 409
					? // Not this season's to take: another season of the show holds the
						// entry, or it is no longer among the candidates (wave 17, round 2).
						`NOT OFFERED FOR THIS ONE · ${what}`
					: NO_ANSWER;

	async function backToSeries(id: number) {
		await goto(resolve('/series/[id]', { id: String(id) }), { invalidateAll: true });
	}

	/** One decision: sent, then the next series (or back to its screen, for one series). */
	async function decide(
		body: object,
		title: string,
		detail: string,
		kind: UndoKind | 'skip'
	): Promise<Record<string, unknown> | null> {
		if (!item || busy) return null;
		const it = item;
		const on = at;
		const before = { queue: [...queue], done };
		busy = true;
		failed = null;
		const r = await post(it.service, {
			series: it.seriesId,
			...(on ? { season: on.no, part: on.part } : {}),
			...body
		});
		busy = false;
		if (!r || !r.ok) {
			if (r?.status === 503) nonet = it.service;
			failed = failText(r, it.service);
			return null;
		}
		const answer = (await r.json().catch(() => ({}))) as Record<string, unknown>;
		const siblings = (answer.siblings as Sibling[] | undefined) ?? [];
		if (single && !siblings.length) {
			await backToSeries(it.seriesId);
			return null;
		}
		if (kind === 'skip') {
			queue = [...queue.slice(1), qk(it)];
			undo = { title, detail, undo: null, before };
			return answer;
		}
		queue = queue.slice(1);
		done += 1;
		undo = {
			title,
			detail,
			undo: {
				kind: kind as UndoKind,
				service: it.service,
				series: it.seriesId,
				// The season the decision was about: UNDO takes that one back, not
				// whichever the page happens to open on (c240).
				...(on ? { season: on.no, part: on.part } : {}),
				was: kind === 'search' ? ((answer.was as QueuedFrom) ?? null) : undefined
			},
			before
		};
		return answer;
	}

	async function undoLast() {
		const u = undo;
		if (!u?.undo || busy) return;
		busy = true;
		const r = await post(u.undo.service, {
			series: u.undo.series,
			undo: u.undo.kind,
			season: u.undo.season,
			part: u.undo.part,
			was: u.undo.was,
			many: u.undo.many,
			facts: u.undo.facts
		});
		if (!r?.ok) {
			busy = false;
			// A refusal says why (c592's part 2, c595's LINK N SEASONS): the band
			// keeps its UNDO, and nothing changed.
			const why = ((await r?.json().catch(() => ({}))) as { message?: string }).message;
			failed = why ? `${why} · NOTHING UNDONE` : NO_ANSWER;
			return;
		}
		// The season under the band came from LINK N SEASONS' answer, which this
		// UNDO has just taken back: its own other part may have been among the
		// picks (c644). Still busy, so no decision can act on the old drawing.
		if (u.undo.kind === 'seasons' && single && season) {
			await redrawSeason(u.undo.series, season.no);
			void refreshToLink();
		}
		busy = false;
		if (u.restore) byKey.set(qk(u.restore), u.restore);
		for (const i of u.restoreMany ?? []) byKey.set(qk(i), i);
		queue = u.before.queue;
		done = u.before.done;
		undo = null;
		sibs = null;
		shown = null;
		// The offers came from the link just taken back: they have no start any more.
		relations = null;
		pickedSeasons = [];
		offerFromLink = false;
	}

	/**
	 * The layout's TO LINK count, once the page stays after a write that moved
	 * it (c644). `backToSeries` refreshed it with `invalidateAll`; ← SERIES is a
	 * plain link and would carry the old number. Only the layout's load depends
	 * on this, so it does not repeat the page's AniList walk.
	 */
	const refreshToLink = () => invalidate('tsundoku:scan');

	/** The page's season as the workstation has it now; unanswered, it stays as drawn. */
	async function redrawSeason(series: number, no: number) {
		const r = await fetch(`${resolve('/links/season')}?series=${series}&season=${no}`).catch(
			() => null
		);
		if (!r?.ok) return;
		const now = (await r.json()) as { single: typeof single; season: typeof season };
		single = now.single;
		season = now.season;
	}

	async function linkChosen() {
		if (!item || !selected) return;
		const c = selected;
		const it = item;
		if (!('work' in c) && second && season) {
			await linkSecond(c, it.seriesId, season.no);
			return;
		}
		if (!('work' in c) && season && staysForTheRest) {
			// A season linked: the page turns to the rest of the show (c240), so it
			// stays rather than going back to the series. A one-season show has no
			// rest, and takes the plain LINK below, back to its screen (c423).
			busy = true;
			failed = null;
			const before = { queue: [...queue], done };
			const r = await post(it.service, {
				series: it.seriesId,
				link: c.anilistId,
				pasted: !!pasted,
				season: season.no,
				part: season.part
			});
			busy = false;
			if (!r?.ok) {
				failed = failText(r, it.service);
				return;
			}
			const a = (await r.json().catch(() => ({}))) as { relations?: RelationOffer[] };
			// No rest to show (AniList unreachable, or no chain neighbour inside the
			// show's seasons): staying would redraw the untouched review, so the LINK
			// goes back to the series as a one-season show's does (c423, round 2).
			if (single && !a.relations?.length) {
				await backToSeries(it.seriesId);
				return;
			}
			relations = a.relations?.length ? a.relations : null;
			pickedSeasons = ticked(relations ?? []);
			offerFromLink = !!relations;
			chosen = null;
			undo = {
				// Season 0 (a flat part of a longer list) names no season (c423).
				title: named
					? `LINKED · SEASON ${named.no} TO ${c.title.toUpperCase()}`
					: `LINKED · ${c.title.toUpperCase()}`,
				detail: `${c.ids} · ITS SEND STARTS WITH THE NEXT EPISODE WATCHED`,
				undo: {
					kind: 'link',
					service: it.service,
					series: it.seriesId,
					season: season.no,
					part: season.part
				},
				before
			};
			return;
		}
		if (!('work' in c)) {
			decide(
				{ link: c.anilistId, pasted: !!pasted },
				// The queue's item names its season, and so does the band (c240).
				`LINKED · ${seasonWord(named)}${c.title.toUpperCase()}`,
				`${c.ids} · ${it.hasCover ? 'COVER STAYS AS IT IS' : 'ITS COVER COMES FROM THE LINK'}`,
				'link'
			);
			return;
		}
		const unit = c.ids.endsWith('WEB NOVEL') ? 'CHAPTERS' : 'VOLUMES';
		const answer = await decide(
			{ link: c.work, pasted: !!pasted },
			`LINKED · ${c.title.toUpperCase()}`,
			`RANOBE ${c.work.toUpperCase()} · ${unit} MAPPED IN THE NEXT PASS`,
			'link'
		);
		const rows = (answer?.siblings as Sibling[] | undefined) ?? [];
		// The siblings as the review now draws them: the work first, chosen just now (1c).
		for (const i of (answer?.items as Item[] | undefined) ?? []) byKey.set(qk(i), i);
		if (rows.length) sibs = { work: c.work, title: c.title, series: it.seriesId, rows, picked: [] };
	}

	/**
	 * LINK 3 SEASONS: the ticked entries written at once. The page stays, also
	 * from `?series=` and also after a full success (c644: the one decision
	 * c423's "deciding goes back to the series" gives way for), because a
	 * multi-season write is the one that needs its UNDO. The band is the
	 * workstation's answer, never the page's own ticks (c418): a pick another
	 * season holds is refused there, and the band says which, with the true count.
	 */
	async function linkSeasonsNow() {
		if (!item || busy || !relations || !pickedSeasons.length) return;
		const it = item;
		const before = { queue: [...queue], done };
		const picks = relations
			.filter((o) => o.ticked && !o.outside && pickedSeasons.includes(o.season))
			.map((o) => ({ season: o.season, part: o.part, anilistId: o.anilistId }));
		busy = true;
		failed = null;
		const r = await post(it.service, {
			series: it.seriesId,
			seasons: picks,
			...(single && season ? { season: season.no } : {})
		});
		busy = false;
		// `linked` and `of` are seasons, not parts: a pair is one (round 2).
		const a = (r ? await r.json().catch(() => ({})) : {}) as {
			linked?: number;
			of?: number;
			refused?: RefusedPick[];
			facts?: SeasonUndoFacts | null;
			review?: { single: typeof single; season: typeof season } | null;
		};
		const refused = a.refused ?? [];
		if (!r?.ok) {
			failed = refused.length
				? `NOTHING LINKED · ${refusedLine(refused)}`
				: failText(r, it.service);
			return;
		}
		const n = a.linked ?? 0;
		relations = null;
		offerFromLink = false;
		// On one series the page stays (c644), so the season it is on is drawn as
		// it now stands -- linked, its LINK row naming the entry -- not as the
		// review it opened on (c465). After a partial link the band names the
		// season still to do.
		if (single && a.review) {
			single = a.review.single;
			season = a.review.season;
			// The pasted entry and the open forms were the review's, before LINK.
			cancelPaste();
			searching = false;
			chosen = null;
		}
		if (single) void refreshToLink();
		if (!single) {
			queue = queue.slice(1);
			done += 1;
		}
		const of = a.of ?? n;
		undo = {
			title: `LINKED ${refused.length ? `${n} OF ${of}` : n} SEASON${of === 1 ? '' : 'S'} · ${it.title.toUpperCase()}`,
			detail: refused.length
				? refusedLine(refused)
				: 'EACH SENDS ITS OWN EPISODES FROM THE NEXT ONE WATCHED',
			// The band takes back every season the post wrote, and only those (c595).
			undo: a.facts
				? { kind: 'seasons', service: it.service, series: it.seriesId, facts: a.facts }
				: null,
			before
		};
	}

	/**
	 * NOT NOW on the rest of the show. After a LINK made here the season is
	 * linked, so for one series the page goes back to it (its LINK row shows
	 * the new link), never to the untouched review it came from (c423, round
	 * 2). An offer that came with the page's load (EDIT on a linked season)
	 * follows no decision: NOT NOW closes it and stays, so the season's own
	 * tools (PASTE A LINK, UNLINK, LINK) are reachable (round 3). In the
	 * queue, the offer closes and the band's UNDO stays.
	 */
	async function notNow() {
		const id = item?.seriesId;
		const leave = offerFromLink;
		relations = null;
		pickedSeasons = [];
		offerFromLink = false;
		if (leave && single && id !== undefined) await backToSeries(id);
	}

	/**
	 * "SEASON 1 NOT LINKED · SEASON 3 HOLDS ITS ENTRY", for each season the
	 * workstation refused. A split season is refused whole (c466), each of its
	 * parts carrying the season's one why, which is said once.
	 */
	const refusedLine = (refused: RefusedPick[]) =>
		[...new Set(refused.map((p) => p.why))].join(' · ');

	/** A ticket on one of the seasons the relations offered. */
	function toggleSeason(n: number) {
		pickedSeasons = pickedSeasons.includes(n)
			? pickedSeasons.filter((x) => x !== n)
			: [...pickedSeasons, n];
	}

	// ---- THE SAME WORK FOR THESE? (Ranobe Review 1b) ------------------------------------------
	const sibAll = $derived(!!sibs && sibs.picked.length === sibs.rows.length);
	function toggleSib(id: number) {
		if (!sibs) return;
		sibs.picked = sibs.picked.includes(id)
			? sibs.picked.filter((x) => x !== id)
			: [...sibs.picked, id];
	}
	async function notThese() {
		const id = sibs?.series;
		sibs = null;
		if (single && id !== undefined) await backToSeries(id);
	}
	async function linkMore() {
		const s = sibs;
		if (!s || !s.picked.length || busy) return;
		const before = { queue: [...queue], done };
		const restoreMany = s.picked
			.map((id) => byKey.get(`ranobe:${id}`))
			.filter((i): i is Item => !!i);
		busy = true;
		failed = null;
		const r = await post('ranobe', { series: s.series, many: s.picked, work: s.work });
		busy = false;
		if (!r?.ok) {
			failed = failText(r, 'ranobe');
			return;
		}
		const { linked } = (await r.json()) as { linked: number[] };
		const gone = new Set(linked.map((id) => `ranobe:${id}`));
		queue = queue.filter((k) => !gone.has(k));
		done += linked.length;
		sibs = null;
		undo = {
			title: `LINKED ${linked.length + 1} SERIES · ${s.title.toUpperCase()}`,
			detail: `RANOBE ${s.work.toUpperCase()} · VOLUMES MAPPED IN THE NEXT PASS`,
			undo: { kind: 'many', service: 'ranobe', series: s.series, many: linked },
			before,
			restoreMany
		};
		if (single) await backToSeries(s.series);
	}

	/**
	 * SEARCH AGAIN, at once (the owner's call, 2026-09-24; the handoff queued it
	 * for the next cover pass). A search the owner runs never links: its
	 * candidates replace these, on the same series, even when there is only one,
	 * and the owner presses LINK (c298). Out of reach, it waits for the pass
	 * after all, and says so.
	 */
	let searchingNow = $state(false);
	async function searchAgain() {
		if (!item || !query.trim() || busy) return;
		const it = item;
		const on = at;
		const q = query.trim();
		const beforeQ = { queue: [...queue], done };
		busy = true;
		searchingNow = true;
		failed = null;
		const r = await post(it.service, {
			series: it.seriesId,
			search: q,
			...(on ? { season: on.no, part: on.part } : {})
		});
		busy = false;
		searchingNow = false;
		if (!r?.ok) {
			failed = NO_ANSWER;
			return;
		}
		const a = (await r.json()) as {
			outcome: 'found' | 'queued';
			found?: number;
			was?: QueuedFrom;
			item: Item | null;
		};
		const back = {
			kind: 'search' as const,
			service: it.service,
			series: it.seriesId,
			// An anime's search is its season's: UNDO puts that season's back (c355).
			...(on ? { season: on.no, part: on.part } : {}),
			was: a.was ?? undefined
		};
		if (a.outcome === 'queued') {
			nonet = it.service;
			queue = queue.slice(1);
			done += 1;
			undo = {
				title: `QUEUED · “${q}”`,
				// AniList's search runs in the cover pass; Ranobe's in its own.
				detail:
					it.service === 'ranobe'
						? 'RANOBE UNREACHABLE · SEARCHED IN THE NEXT PASS'
						: 'ANILIST UNREACHABLE · SEARCHED IN THE NEXT COVER PASS',
				undo: back,
				before: beforeQ,
				restore: it
			};
			return;
		}
		if (a.item) byKey.set(qk(a.item), a.item);
		// Drawn afresh: the new candidates, nothing chosen, the panels shut.
		shown = null;
		undo = {
			title: `SEARCHED · “${q}” · ${a.found ?? 0} FOUND`,
			detail: a.found
				? it.service === 'ranobe'
					? 'TAP ONE TO LINK'
					: 'NOTHING IS LINKED BY A SEARCH · TAP ONE TO LINK'
				: 'NOTHING UNDER THIS TITLE EITHER',
			undo: back,
			before: beforeQ,
			restore: it
		};
	}

	/**
	 * SUGGEST TO RANOBE (card c72): the EPUB's work and authors, sent through
	 * the app account, waiting for the owner on Ranobe. Ranobe is searched
	 * once more first: a work that arrived since comes back as candidates.
	 */
	async function suggestIt() {
		if (!item || busy || item.service !== 'ranobe') return;
		const it = item;
		const before = { queue: [...queue], done };
		busy = true;
		failed = null;
		const r = await post('ranobe', { series: it.seriesId, suggest: true });
		busy = false;
		if (!r?.ok) {
			if (r?.status === 503) nonet = 'ranobe';
			failed = failText(r, 'ranobe', 'NOTHING SENT');
			return;
		}
		const a = (await r.json()) as {
			outcome: 'suggested' | 'found';
			bundle?: number;
			found?: number;
			item: Item | null;
		};
		if (a.outcome === 'found') {
			if (a.item) byKey.set(qk(a.item), a.item);
			shown = null;
			undo = {
				title: `RANOBE HAS IT NOW · ${a.found} FOUND`,
				detail: 'NOTHING SUGGESTED · TAP ONE TO LINK',
				undo: null,
				before
			};
			return;
		}
		if (single) {
			await backToSeries(it.seriesId);
			return;
		}
		queue = queue.slice(1);
		done += 1;
		undo = {
			title: 'SUGGESTED TO RANOBE · WAITS FOR YOUR REVIEW THERE',
			detail: `BUNDLE ${a.bundle} · LINKED IN THE PASS AFTER YOU APPROVE IT`,
			undo: { kind: 'suggest', service: 'ranobe', series: it.seriesId },
			before
		};
	}

	// FIND on a series never searched: searched as the review opens.
	let autoSearched = false;
	$effect(() => {
		if (autoSearched || !single || !item || item.searched || single.queued || noSearch || off)
			return;
		autoSearched = true;
		void searchAgain();
	});

	// ---- a pasted link, read as one candidate (Link Review 1d, Ranobe Review 1e) --------------
	let reading = 0;
	async function readPaste(text: string) {
		pasteText = text;
		pastedHeld = null;
		if (!item) return;
		const it = item;
		const r1 = it.service === 'ranobe';
		const ok = r1 ? parseRanobeUrl(text) !== null : parsePasted(text, it.kind) !== null;
		if (!ok) {
			pasted = null;
			pasteNote = text.trim()
				? r1
					? 'NOT A RANOBE WORK LINK'
					: it.kind === 'anime'
						? 'NOT AN ANILIST OR MAL ANIME LINK'
						: 'NOT AN ANILIST OR MAL MANGA LINK'
				: null;
			return;
		}
		const mine = ++reading;
		pasteNote = 'READING…';
		const r = await post(it.service, {
			series: it.seriesId,
			...(at ? { season: at.no, part: at.part } : {}),
			paste: text
		});
		if (mine !== reading) return;
		if (!r) {
			pasteNote = NO_ANSWER;
			return;
		}
		if (r.status === 503) {
			nonet = it.service;
			pasteNote = `${SERVICE_NAME[it.service]} DID NOT ANSWER · TRY AGAIN WHEN IT’S BACK`;
			return;
		}
		if (!r.ok) {
			pasted = null;
			pasteNote = r1
				? 'NO SUCH WORK ON RANOBE'
				: parsePasted(text, it.kind)?.service === 'mal'
					? 'ANILIST HAS NO ENTRY FOR THAT MAL ID'
					: 'NO SUCH ANILIST ENTRY';
			return;
		}
		const { candidate, held } = (await r.json()) as { candidate: Cand; held?: string | null };
		pasted = candidate;
		chosen = keyOf(candidate);
		nonet = null;
		pastedHeld = held ?? null;
		pasteNote =
			'work' in candidate
				? `READ AS RANOBE ${candidate.work.toUpperCase()} · ITS ${langName('en')} EDITION IS TAKEN, OR SUGGESTED, IN THE NEXT PASS`
				: (pastedHeld ??
					`READ AS ANILIST ${candidate.anilistId} · ONLY THE ID WAS SENT, NEVER THE TITLE`);
	}
	function cancelPaste() {
		pasting = false;
		pasted = null;
		pastedHeld = null;
		pasteText = '';
		pasteNote = null;
		chosen = null;
	}

	// ---- actions -----------------------------------------------------------------------------
	type Act = { label: string; run: () => void; strong?: boolean; dim?: boolean };
	const netDim = $derived(off || (item !== null && nonet === item.service));
	const openSearch = () => ((searching = !searching), (pasting = false));
	/** The search field, to put the caret back in when SEARCH AGAIN is pressed while open. */
	let searchField = $state<HTMLInputElement | null>(null);
	function showSearch() {
		if (searching) {
			searchField?.focus();
			return;
		}
		searching = true;
		pasting = false;
	}
	const openPaste = () => ((pasting = !pasting), (searching = false));
	const notOn = () =>
		decide(
			{ none: true },
			'NOT ON RANOBE · WON’T ASK AGAIN',
			'NOTHING SENT · ITS TRACKING ROW SAYS NOT ON RANOBE',
			'none'
		);
	const skipIt = () => decide({ skip: true }, 'SKIPPED', 'COMES UP AGAIN LATER', 'skip');
	const tools = $derived.by((): Act[] => {
		if (!item || pasted || !item.candidates.length) return [];
		return [
			{ label: 'SEARCH AGAIN', run: openSearch, dim: netDim || noSearch },
			{ label: 'PASTE A LINK', run: openPaste, dim: netDim },
			// A linked season's own UNLINK: gone, and no pass searches it again
			// (c240). The series screen's EDIT on the season line comes here.
			...unlinkAct
		];
	});
	/**
	 * A linked season's own UNLINK, wherever the season's tools are drawn: in
	 * the tool row beside its candidates, or among the actions when it has
	 * none (a season linked by a pasted link was never searched, round 3).
	 */
	const unlinkAct = $derived<Act[]>(
		season && single?.linked ? [{ label: 'UNLINK', run: unlinkSeason, dim: netDim }] : []
	);

	/**
	 * LINK on a second part (c350): part 2 written through the same door as
	 * every season's LINK, with where it starts. A refusal (another season
	 * holds the entry, or a start the schema cannot keep) says why, in the
	 * workstation's words; the link goes back to the series, where its line
	 * names the part.
	 */
	async function linkSecond(c: ReviewCandidate, seriesId: number, no: number) {
		if (busy || fromWhy) return;
		busy = true;
		failed = null;
		const r = await post('anilist', {
			series: seriesId,
			link: c.anilistId,
			pasted: !!pasted,
			season: no,
			part: 2,
			from: Number(fromEp.trim())
		});
		busy = false;
		if (!r?.ok) {
			const why =
				r?.status === 409
					? ((await r.json().catch(() => null)) as { message?: string } | null)?.message
					: null;
			failed =
				why && why !== 'not a candidate' && why !== 'another season holds that entry'
					? `NOT LINKED · ${why}`
					: failText(r, 'anilist');
			return;
		}
		await backToSeries(seriesId);
	}

	/** UNLINK on a season: its row goes, and the series' mirror with it. */
	async function unlinkSeason() {
		if (!item || !season || busy) return;
		const it = item;
		busy = true;
		failed = null;
		// A second part's UNLINK is part 2's alone (c350).
		const r = await post(it.service, {
			series: it.seriesId,
			unlink: true,
			season: season.no,
			...(second ? { part: 2 } : {})
		});
		busy = false;
		if (!r?.ok) {
			failed = failText(r, it.service);
			return;
		}
		if (single) await backToSeries(it.seriesId);
	}
	const actions = $derived.by((): Act[] => {
		if (!item) return [];
		const link: Act = selected
			? {
					// The season the LINK writes: the page's, or the queue item's own (c240).
					label: second
						? named
							? `LINK ${selectedLetter} TO SEASON ${named.no} PART 2`
							: `LINK ${selectedLetter} TO PART 2`
						: named
							? `LINK ${selectedLetter} TO SEASON ${named.no}`
							: `LINK ${selectedLetter}`,
					run: linkChosen,
					strong: true,
					dim: off || (!!pasted && !!pastedHeld) || !!fromWhy
				}
			: { label: 'TAP ONE TO LINK', run: () => {}, dim: true };
		if (pasted) return [{ label: 'CANCEL', run: cancelPaste, dim: off }, link];
		// SEARCH AGAIN only opens the form, and a press while it is open only
		// puts the caret in its field: the search is the form's own SEARCH, below
		// it. Once this cell ran the search when open, so the second tap of a
		// double tap, or the press that opened it on a slow render, searched the
		// shown title nobody typed (c329).
		const search: Act = {
			label: 'SEARCH AGAIN',
			run: showSearch,
			strong: searching,
			dim: netDim || noSearch
		};
		const paste: Act = { label: 'PASTE A LINK', run: openPaste, dim: netDim };
		// Ranobe with nothing found (1d): NOT ON RANOBE settles it.
		if (!item.candidates.length && ranobe)
			return [...(single ? [] : [{ label: 'NOT ON RANOBE', run: notOn, dim: off }]), search, paste];
		// SKIP too with nothing found: the owner's addition to 1c, so a series
		// with no answer yet doesn't block the queue.
		if (!item.candidates.length)
			return [
				search,
				paste,
				...unlinkAct,
				...(single ? [] : [{ label: 'SKIP', run: skipIt, dim: off }])
			];
		// A second part settles nothing of the season: NOT NOW goes back to it.
		if (second)
			return [
				{ label: 'NOT NOW', run: () => item && backToSeries(item.seriesId), dim: false },
				link
			];
		return [
			{
				label: 'NONE OF THESE',
				run: ranobe
					? notOn
					: () =>
							decide(
								{ none: true },
								`NONE OF THESE · ${seasonWord(named)}WON’T ASK AGAIN`,
								'FIND AND PASTE A LINK STILL WORK ON ITS SERIES SCREEN',
								'none'
							),
				dim: off
			},
			...(single ? [] : [{ label: 'SKIP', run: skipIt, dim: off }]),
			link
		];
	});
	const actionCols = $derived(
		pasted || !item?.candidates.length
			? pasted
				? '1fr 1.4fr'
				: actions.map(() => '1fr').join(' ')
			: actions.length === 3
				? '1fr 1fr 1.4fr'
				: '1fr 1.4fr'
	);

	const counter = $derived(
		item ? `${String(done + 1).padStart(2, '0')} OF ${String(total).padStart(2, '0')}` : '00'
	);
	const back = $derived(
		single && item
			? { href: resolve('/series/[id]', { id: String(item.seriesId) }), label: '← SERIES' }
			: { href: resolve('/'), label: '← LIBRARY' }
	);
	/**
	 * A search the owner has just run says "JUST NOW"; anything older is
	 * "EARLIER". `searched_at` is written by both the owner and the pass, so it
	 * cannot say who searched, and the band must not claim the pass ran it.
	 */
	const when = (at: number | null, now: number) =>
		at !== null && now - at < 120_000 ? 'JUST NOW' : 'EARLIER';
	const searched = $derived(
		!item
			? ''
			: noSearch
				? 'HIDDEN SERIES ARE NEVER SEARCHED · ONLY A PASTED LINK, WHICH SENDS NOTHING BUT ITS ID'
				: item.service === 'ranobe'
					? item.searchedLine
					: single?.queued
						? `A SEARCH FOR “${item.query}” WAITS FOR THE NEXT COVER PASS`
						: !item.searched
							? 'NOT SEARCHED YET · SEARCH AGAIN ASKS ANILIST NOW'
							: `SEARCHED ANILIST FOR “${item.query}” ${when(item.searchedAt, Date.now())} · ${item.found} FOUND${item.found ? ' · TAP ONE TO LINK' : ''}`
	);
	const hint = $derived(
		item?.cutShort
			? 'THE TITLE ENDS IN “...”, SO MIHON PROBABLY CUT IT SHORT. SEARCH AGAIN WITH THE END TRIMMED OR COMPLETED, OR PASTE THE ENTRY’S LINK.'
			: 'SEARCH AGAIN UNDER ANOTHER TITLE, OR PASTE THE ENTRY’S LINK.'
	);
	/** THIS SERIES' rows: Ranobe's four (1a), or AniList's. */
	const seriesRows = $derived.by((): { label: string; value: string }[] => {
		if (!item) return [];
		if (item.service === 'ranobe') return item.rows;
		return [
			// An Aniyomi source is the series' own; a manga's second name is the
			// site its files came from. One name when they are the same (c298).
			{
				label: 'SOURCE',
				value: [...new Set([item.sourceKind, item.source].filter(Boolean))].join(' · ')
			},
			{ label: item.kind === 'anime' ? 'EPISODES' : 'CHAPTERS', value: String(item.chapters) },
			{ label: 'COVER', value: [item.cover.a, item.cover.b].filter(Boolean).join(' · ') }
		];
	});
	const candCount = $derived(
		pasted
			? 'work' in pasted
				? `RANOBE ${pasted.work.toUpperCase()}`
				: `ANILIST ${pasted.anilistId}`
			: cands.length
				? ranobe
					? `${cands.length} FOUND · A WORK, NOT AN EDITION`
					: `${cands.length}${item && item.found > cands.length ? ` OF ${item.found}` : ''} FOUND · TAP ONE`
				: ranobe
					? 'NOVELS · 0 FOUND'
					: '0 FOUND'
	);

	// The next series' candidate covers, fetched while this one is decided.
	$effect(() => {
		const next = queue[1] ? byKey.get(queue[1]) : null;
		for (const c of (next?.candidates as Cand[] | undefined) ?? [])
			if (c.coverUrl) new Image().src = c.coverUrl;
	});
</script>

<svelte:head><title>Links · tsundoku</title></svelte:head>

<div class="review">
	<header class="head">
		<a class="back" href={back.href}>{back.label}</a>
		<div class="heading">
			{#if named && second}
				<span class="long">LINK · SEASON {named.no} · PART 2</span><span class="short"
					>S{named.no} P2</span
				>
			{:else if named}
				<span class="long">LINK · SEASON {named.no}</span><span class="short">S{named.no}</span>
			{:else}
				<span class="long">SERIES TO LINK</span><span class="short">TO LINK</span>
			{/if}
		</div>
		<div class="counter">{counter}</div>
	</header>

	{#if season && item}
		<!-- FIND on a season asks the anime catalogue with that season's own title
		     (c240): the header says what was asked and what is compared. -->
		<div class="seasonbar">
			<div class="sb-a">{item.title.toUpperCase()}</div>
			<div class="sb-b">
				{named ? `SEASON ${named.no} OF ${season.of} · ` : ''}{season.aired} EPISODES HERE{season.count >
				season.aired
					? ` AND ${season.count - season.aired} RECAP`
					: ''}{second
					? ` · PART 2 FROM EP. ${second.from}`
					: season.parts.length > 1
						? ` · ${season.parts.length} PARTS`
						: ''}
			</div>
			<div class="sb-c">ASKED AS {season.title.toUpperCase()}</div>
		</div>
	{/if}

	{#if off}
		<div class="band two" role="status">
			<div class="bt">
				<div class="line">○ OFFLINE · LINKING NEEDS THE WORKSTATION</div>
				<div class="line dim">
					AS FOUND IN THE LAST COVER PASS · NOTHING CAN BE DECIDED UNTIL IT ANSWERS
				</div>
			</div>
		</div>
	{:else if nonet}
		<div class="band two" role="status">
			<div class="bt">
				<div class="line">○ {SERVICE_NAME[nonet]} UNREACHABLE · LINK STILL WORKS</div>
				<div class="line dim">
					THE WORKSTATION HAS NO INTERNET · SEARCH AGAIN AND PASTE A LINK WAIT FOR IT
				</div>
			</div>
		</div>
	{/if}

	{#if failed}
		<div class="band" role="alert"><div class="bt"><div class="line">{failed}</div></div></div>
	{:else if undo}
		<div class="band" role="status">
			<div class="bt">
				<div class="line">{undo.title}</div>
				<div class="line dim">{undo.detail}</div>
			</div>
			{#if undo.undo}<button type="button" class="undo" onclick={undoLast}>UNDO</button>{/if}
		</div>
	{/if}

	{#if sibs}
		<div class="sibs">
			<div class="sibhead">
				<div class="sibq">THE SAME WORK FOR THESE?</div>
				<div class="siblead">{sibs.title}</div>
				<div class="sibwhy">
					{sibs.rows.length}
					{sibs.rows.length === 1
						? 'MORE SERIES WAITING ON RANOBE HAS'
						: 'MORE SERIES WAITING ON RANOBE HAVE'}
					THIS TITLE BEFORE A VOLUME NUMBER.
				</div>
			</div>
			<div class="ch">
				<div>01 — SERIES</div>
				<div>
					{sibs.picked.length
						? `${sibs.picked.length} OF ${sibs.rows.length} TAPPED`
						: `${sibs.rows.length} · TAP THE ONES THAT ARE`}
				</div>
			</div>
			<div class="siblist">
				{#each sibs.rows as r (r.seriesId)}
					{@const on = sibs.picked.includes(r.seriesId)}
					<button
						type="button"
						class="sib"
						class:on
						aria-pressed={on}
						onclick={() => toggleSib(r.seriesId)}
					>
						<span class="tickcell"><span class="tick">{on ? '✓' : ''}</span></span>
						<span class="sibcover" style:background={coverPlaceholder(hueFor(r.title))}></span>
						<span class="sibtext">
							<span class="sibtitle">{r.title}</span>
							<span class="sibmeta">{r.meta}</span>
						</span>
					</button>
				{/each}
			</div>
			<div class="sibnotes">
				<div>ONLY SERIES STILL WAITING ON RANOBE ARE LISTED. NOTHING IS PRESELECTED.</div>
				<div>
					EACH ONE MAPS ONTO ITS OWN VOLUMES OF THE EDITION. TWO COPIES OF ONE VOLUME COUNT ONCE.
				</div>
				<div>ONE LEFT OUT STAYS IN THE QUEUE, WITH THIS WORK AS ITS FIRST CANDIDATE.</div>
			</div>
		</div>
		<div class="actions" style:grid-template-columns="1fr 1fr 1.4fr">
			<button type="button" class="first" disabled={busy} onclick={notThese}>NOT THESE</button>
			<button
				type="button"
				disabled={busy}
				onclick={() => sibs && (sibs.picked = sibAll ? [] : sibs.rows.map((r) => r.seriesId))}
				>{sibAll ? 'CLEAR' : `TAP ALL ${sibs.rows.length}`}</button
			>
			{#if sibs.picked.length}
				<button type="button" class="strong" disabled={busy || off} onclick={linkMore}
					>LINK {sibs.picked.length} MORE</button
				>
			{:else}
				<button type="button" class="dim" disabled>TAP THE ONES THAT ARE</button>
			{/if}
		</div>
	{:else if !item}
		<section class="empty">
			<div class="label">00 — NOTHING TO LINK</div>
			<p>Every series found has been settled. New ones are searched in the next pass.</p>
			<a class="home" href={resolve('/')}>BACK TO LIBRARY</a>
		</section>
	{:else}
		{#key qk(item)}
			<div class="body">
				<section class="series" aria-label="This series">
					<div class="sl">THIS SERIES</div>
					<div class="who">
						<div
							class="cover"
							class:none={!item.hasCover}
							style:background={item.hasCover ? coverPlaceholder(item.hue) : undefined}
						>
							{#if item.hasCover}
								<img src={coverSrc(item.seriesId, item.coverAt)} alt="" />
							{:else}
								<span class="nc">NO COVER</span>
							{/if}
						</div>
						<div class="id">
							<div class="meta">{item.kind.toUpperCase()} · {item.sourceKind}</div>
							<div class="title">{item.title}</div>
							{#each item.alts as al (al)}<div class="alt">{al}</div>{/each}
						</div>
					</div>
					<div class="rows">
						{#each seriesRows as row (row.label)}
							<div class="r"><span class="rl">{row.label}</span><span>{row.value}</span></div>
						{/each}
						{#if second}
							<!-- The season's second part by hand (c350): part 1 as it stands,
							     and where part 2 starts, filled from part 1's count. -->
							<div class="r">
								<span class="rl">PART 1</span>
								<span>{second.part1} · EP. 1 – {second.after}</span>
							</div>
							<div class="r from">
								<span class="rl">FROM EP.</span>
								<span class="fromcell">
									<input
										type="text"
										inputmode="numeric"
										class="fromep"
										bind:value={fromEp}
										aria-label="Part 2 starts at the season’s episode"
										autocomplete="off"
									/>
									<span class="fromnote"
										>{fromWhy ?? `PART 2’S EP. 1 IS THE SEASON’S EP. ${second.from}`}</span
									>
								</span>
							</div>
						{/if}
						{#if single?.linked}
							<div class="r">
								<span class="rl">{second ? 'PART 2' : 'LINKED'}</span>
								<span>{single.linked} · A NEW LINK REPLACES IT</span>
							</div>
						{/if}
						{#if addSecond}
							<!-- The design's BY HAND (c350): a season a catalogue splits at an
							     episode its relations do not show. A full load, so the page
							     opens on part 2's own search. -->
							<div class="r">
								<span class="rl">PART 2</span>
								<span
									>AFTER PART 1’S {season?.second?.after} EPISODES ·
									<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- secondHref is resolve('/links') with its query -->
									<a class="relink" href={secondHref} data-sveltekit-reload>+ A SECOND PART</a
									></span
								>
							</div>
						{/if}
						{#if single?.wrongKind}
							<div class="r">
								<span class="rl">WRONG KIND</span>
								<span
									>LINKED TO THE WRONG KIND · NOT UNLINKED, SO UNDO STILL TAKES IT BACK ·
									<button
										type="button"
										class="relink"
										onclick={openSearch}
										disabled={netDim || noSearch}>RELINK</button
									></span
								>
							</div>
						{/if}
					</div>
					{#if searched}<div class="searched">{searched}</div>{/if}
				</section>

				<div class="cands">
					<div class="ch">
						<div>
							{pasted ? '01 — FROM YOUR LINK' : ranobe ? '01 — ON RANOBE' : '01 — CANDIDATES'}
						</div>
						<div>{candCount}</div>
					</div>

					{#if cands.length}
						<div class="grid">
							{#each cands as c, i (keyOf(c))}
								{@const key = keyOf(c)}
								{@const on = chosen === key}
								{@const note = 'coverNote' in c ? c.coverNote : null}
								{@const exactTitle =
									!('work' in c) && item
										? isExact(matchTitles([item.title, ...item.alts], item.query), c)
										: false}
								<div
									class="cand"
									class:on
									class:faded={chosen !== null && !on}
									class:off
									role="button"
									tabindex="0"
									aria-pressed={on}
									onclick={() => !off && (chosen = on ? null : key)}
									onkeydown={(e) =>
										(e.key === 'Enter' || e.key === ' ') &&
										!off &&
										(e.preventDefault(), (chosen = on ? null : key))}
								>
									<div class="strip">
										<div class="letter">{letter(i)}</div>
										<div class="ids">{c.ids}</div>
										{#if exactTitle}<div class="chip exact">EXACT TITLE</div>{/if}
										{#if on}<div class="chip">✓ LINK THIS</div>{/if}
										<a
											class="open"
											href={hrefOf(c)}
											target="_blank"
											rel="noopener noreferrer external"
											onclick={(e) => e.stopPropagation()}>OPEN ↗</a
										>
									</div>
									<div class="cb">
										<div
											class="ccover"
											class:noted={note}
											style:background={note ? undefined : coverPlaceholder(hueFor(c.title))}
										>
											{#if c.coverUrl}<img src={c.coverUrl} alt="" loading="lazy" />{/if}
											{#if note}<span class="nc">{note}</span>{/if}
										</div>
										<div class="ct">
											<div class="ctitle">{c.title}</div>
											{#if !ranobe && c.alts.length}
												<div class="calts">
													{#each c.alts.slice(0, 3) as al (al)}<div class="alt">{al}</div>{/each}
												</div>
											{/if}
											<div class="why">{c.why}</div>
											<div class="rows">
												{#each c.rows as row (row.label)}
													<div class="r tight">
														<span class="rl">{row.label}</span>
														<span class:agree={row.agree}>{row.value}</span>
													</div>
												{/each}
											</div>
										</div>
									</div>
								</div>
							{/each}
						</div>
					{:else if ranobe}
						<div class="nothing">
							<p>Ranobe doesn’t have this novel.</p>
							<div class="hint">
								NOT ON RANOBE DOES NOTHING ELSE, FOR NOW: THE SERIES STAYS UNLINKED, ITS READS STAY
								HERE, AND IT ISN’T ASKED ABOUT AGAIN. ITS AUTHOR AND TITLE ARE NEVER SENT.
							</div>
						</div>
						{#if data.canSuggest && !noSearch}
							<div class="suggest live">
								<div class="st">
									<div class="sn">SUGGEST TO RANOBE</div>
									<div class="sd">
										FROM THE EPUB’S OWN TITLE AND AUTHOR · WAITS FOR YOUR REVIEW ON RANOBE
									</div>
								</div>
								<button type="button" class="sy" disabled={busy || netDim} onclick={suggestIt}
									>SUGGEST</button
								>
							</div>
						{:else}
							<div class="suggest" aria-disabled="true">
								<div class="st">
									<div class="sn">SUGGEST TO RANOBE</div>
									<div class="sd">
										{noSearch
											? 'HIDDEN SERIES ARE NEVER SUGGESTED'
											: 'NEEDS RANOBE_SUGGEST_TOKEN, THE APP ACCOUNT’S · DOC/RANOBE.MD'}
									</div>
								</div>
								<div class="sy">NOT YET</div>
							</div>
						{/if}
					{:else}
						<div class="nothing">
							<p>AniList found nothing under this title.</p>
							<div class="hint">{hint}</div>
						</div>
					{/if}

					{#if searching && !noSearch}
						<div class="ch">
							<div>02 — SEARCH AGAIN</div>
							<div>{name} · TITLE</div>
						</div>
						<form
							class="field"
							onsubmit={(e) => {
								e.preventDefault();
								searchAgain();
							}}
						>
							<!-- svelte-ignore a11y_autofocus -->
							<input
								type="text"
								bind:this={searchField}
								bind:value={query}
								aria-label={ranobe ? 'Title to search on Ranobe' : 'Title to search on AniList'}
								autocomplete="off"
								autofocus
							/>
							<button type="submit" class="go" disabled={netDim || busy}
								>{searchingNow ? 'SEARCHING…' : 'SEARCH'}</button
							>
						</form>
						<div class="fnote">
							{ranobe
								? 'RANOBE IS ASKED NOW, WITH THIS TITLE ONLY, NOVELS ONLY. NOTHING IS LINKED: WHAT IT FINDS COMES BACK HERE TO CHOOSE FROM.'
								: 'ANILIST IS ASKED NOW, WITH THIS TITLE ONLY, IN THIS SERIES’ OWN KIND. NOTHING IS LINKED: WHAT IT FINDS COMES BACK HERE TO CHOOSE FROM.'}
						</div>
					{/if}

					{#if pasting}
						<div class="ch">
							<div>02 — PASTE A LINK</div>
							<div>{ranobe ? 'RANOBE' : 'ANILIST OR MAL'}</div>
						</div>
						<div class="field">
							<!-- svelte-ignore a11y_autofocus -->
							<input
								type="url"
								class="mono"
								value={pasteText}
								oninput={(e) => readPaste(e.currentTarget.value)}
								placeholder={ranobe
									? 'ranobe.ink/w…'
									: item?.kind === 'anime'
										? 'anilist.co/anime/… or myanimelist.net/anime/…'
										: 'anilist.co/manga/… or myanimelist.net/manga/…'}
								aria-label={ranobe ? 'Ranobe link' : 'AniList or MAL link'}
								autocomplete="off"
								autofocus
								disabled={off}
							/>
						</div>
						<div class="fnote last">
							{pasteNote ??
								(ranobe
									? 'ONLY THE ID IN THE LINK IS READ'
									: 'ONLY THE ID IN THE LINK IS SENT, NEVER THE TITLE')}
						</div>
					{/if}
				</div>
			</div>
		{/key}

		{#if relations && relations.length}
			<!-- 02 — THE REST OF THE SERIES ON ANILIST (Track Calls, "Linking four
			     seasons without four searches"; c240). Matched by order along the
			     entry's own prequel and sequel chain, then checked by episode count;
			     ticked where it agrees, and a pair that adds up is one season in two
			     parts. A movie or a special is outside the numbering and never ticked. -->
			<section class="rels" aria-label="The other seasons">
				<div class="ch">
					<div>02 — THE REST OF THE SERIES ON ANILIST</div>
					<div>
						{pickedSeasons.length} OF {new Set(
							relations.filter((o) => !o.outside).map((o) => o.season)
						).size} TICKED
					</div>
				</div>
				<div class="relnotes">
					<div>
						A SEASON IS MATCHED BY ORDER ALONG THE CHAIN, THEN CHECKED BY ITS EPISODE COUNT.
					</div>
					<div>
						A SEASON ALREADY LINKED TO SOMETHING ELSE SAYS “REPLACES …” AND IS NEVER TICKED.
					</div>
					<div>AN ENTRY ANOTHER SEASON HOLDS SAYS WHICH, AND IS NEVER TICKED.</div>
				</div>
				<div class="rellist">
					{#each relations as o (`${o.season}:${o.part}:${o.anilistId}`)}
						<!-- A ✓ only on an offer that can be ticked: never one outside the
					     numbering (c351), nor one another season holds (c418), even when
					     its season is ticked through another entry. -->
						{@const on = pickedSeasons.includes(o.season) && o.ticked && !o.outside}
						<div class="rel" class:on class:outside={o.outside}>
							<button
								type="button"
								class="relbtn"
								class:on
								disabled={o.outside || !o.ticked || busy}
								aria-pressed={on}
								onclick={() => toggleSeason(o.season)}
							>
								<span class="tickcell"><span class="tick">{on ? '✓' : ''}</span></span>
								<span class="rno"
									>{o.outside ? '–' : o.part > 1 ? `PART ${o.part}` : seasonTag(o.season)}</span
								>
								<span class="rtext">
									<span class="rtitle">{o.title}</span>
									<span class="rmeta">
										{[
											o.how,
											o.format ? o.format.replace(/_/g, ' ') : '',
											o.episodes ? `${o.episodes} EP.` : '',
											o.year
										]
											.filter(Boolean)
											.join(' · ')}
									</span>
									<span class="rwhy" class:ink={o.ticked || o.outside}>
										{o.why}{o.replaces ? ` · REPLACES ${o.replaces.toUpperCase()}` : ''}
									</span>
								</span>
							</button>
						</div>
					{/each}
				</div>
				<div class="relacts">
					<button type="button" class="first" disabled={busy} onclick={notNow}>NOT NOW</button>
					{#if pickedSeasons.length}
						<button type="button" class="strong" disabled={busy} onclick={linkSeasonsNow}
							>LINK {pickedSeasons.length} SEASON{pickedSeasons.length === 1 ? '' : 'S'}</button
						>
					{:else}
						<button type="button" class="dim" disabled>TAP A SEASON TO LINK IT</button>
					{/if}
				</div>
			</section>
		{:else}
			{#if tools.length}
				<div class="tools">
					{#each tools as t, i (t.label)}
						<button
							type="button"
							class:first={i === 0}
							class:dim={t.dim}
							disabled={t.dim || busy}
							onclick={t.run}>{t.label}</button
						>
					{/each}
				</div>
			{/if}
			<div class="actions" style:grid-template-columns={actionCols}>
				{#each actions as act, i (act.label)}
					<button
						type="button"
						class:strong={act.strong}
						class:first={i === 0}
						class:dim={act.dim}
						disabled={act.dim || busy}
						onclick={act.run}>{act.label}</button
					>
				{/each}
			</div>
		{/if}
	{/if}
</div>

<style>
	/*
	 * Link Review, transcribed: the mock's spacing is hand-set, not a ladder
	 * (as Pair Review's), so the literals are the decisions. Colours are tokens.
	 */
	.review {
		--pad: 24px;
		--head-h: 72px;
		--cover-w: 104px;
		--cand-cover-w: 96px;
		--title-size: 22px;
		--cand-title: 18px;
		--label-col: 104px;
		--act-font: 14px;
		flex: 1;
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		background: var(--surface-page);
		color: var(--text-1);
		font-family: var(--font-sans);
	}
	@media (max-width: 599px) {
		.review {
			--pad: 16px;
			--head-h: 60px;
			--cover-w: 72px;
			--cand-cover-w: 64px;
			--title-size: 18px;
			--cand-title: 16px;
			--label-col: 84px;
			--act-font: 12px;
		}
	}
	@media (min-width: 1200px) {
		.review {
			--cover-w: 120px;
			height: 100dvh;
			min-height: 0;
		}
	}
	.head {
		flex-shrink: 0;
		display: flex;
		align-items: stretch;
		height: var(--head-h);
		border-bottom: 1px solid var(--line-1);
	}
	.back {
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		border-right: 1px solid var(--line-1);
		color: var(--text-1);
		font: 500 14px/1.2 var(--font-mono);
		text-decoration: none;
	}
	.heading {
		flex: 1;
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		min-width: 0;
		font: 500 13px/1.2 var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.heading .short {
		display: none;
	}
	@media (max-width: 599px) {
		.heading .long {
			display: none;
		}
		.heading .short {
			display: inline;
		}
	}
	.counter {
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		border-left: 1px solid var(--line-1);
		font: 500 14px/1.2 var(--font-mono);
		white-space: nowrap;
	}
	.band {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		height: 60px;
		padding-left: var(--pad);
		border-bottom: 1px solid var(--line-1);
		background: var(--surface-panel);
		font: 500 14px/1.2 var(--font-mono);
	}
	.band.two {
		height: auto;
		min-height: 60px;
		padding: 8px var(--pad);
	}
	.bt {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
	}
	.line {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.band.two .line {
		white-space: normal;
	}
	.line.dim {
		font: 400 13px/1.3 var(--font-mono);
		color: var(--text-2);
	}
	.undo {
		align-self: stretch;
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		border: 0;
		border-left: 1px solid var(--line-1);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 14px/1.2 var(--font-mono);
		cursor: pointer;
	}
	.undo:active,
	.home:active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.empty {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 18px;
		padding: 64px var(--pad);
	}
	.empty .label {
		font: 500 13px/1.2 var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.empty p {
		margin: 0;
		max-width: 460px;
		font: 500 22px/1.25 var(--font-sans);
		text-wrap: pretty;
	}
	.home {
		display: flex;
		align-items: center;
		height: 56px;
		padding: 0 28px;
		border: 1px solid var(--line-2);
		color: var(--text-1);
		font: 500 16px var(--font-mono);
		text-decoration: none;
	}

	/* The body: the series above its candidates, or beside them on desktop (1j). */
	.body {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	@media (min-width: 1200px) {
		.body {
			flex-direction: row;
			overflow: hidden;
		}
	}
	.series {
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: 16px var(--pad) 18px;
		background: var(--surface-panel);
		border-bottom: 1px solid var(--line-1);
	}
	@media (min-width: 1200px) {
		.series {
			width: 420px;
			border-right: 1px solid var(--line-1);
		}
	}
	.sl,
	.ch {
		font: 500 13px/1.2 var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.who {
		display: flex;
		gap: 18px;
	}
	.cover {
		position: relative;
		flex-shrink: 0;
		width: var(--cover-w);
		aspect-ratio: 2 / 2.9;
		overflow: hidden;
	}
	.cover.none {
		background: var(--surface-page);
		border: 1px solid var(--line-2);
	}
	.cover img,
	.ccover img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.nc {
		position: absolute;
		inset: 0;
		padding: 8px;
		font: 500 11px/1.3 var(--font-mono);
		color: var(--text-2);
		letter-spacing: 0.06em;
	}
	.id {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.meta {
		font: 500 13px/1.3 var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.title {
		font: 500 var(--title-size) / 1.2 var(--font-sans);
		text-wrap: pretty;
	}
	.alt {
		font: 400 14px/1.35 var(--font-sans);
		color: var(--text-2);
	}
	.rows {
		display: flex;
		flex-direction: column;
		border-top: 1px solid var(--line-1);
	}
	.r {
		display: grid;
		grid-template-columns: var(--label-col) minmax(0, 1fr);
		align-items: center;
		min-height: 34px;
		border-bottom: 1px solid var(--line-subtle);
		font: 400 13px/1.3 var(--font-mono);
	}
	.r.tight {
		min-height: 32px;
	}
	.rl {
		color: var(--text-2);
		letter-spacing: 0.06em;
	}
	.r .agree {
		font-weight: 500;
	}
	.r.tight span:not(.rl):not(.agree) {
		color: var(--text-2);
	}
	/* RELINK sits in the row it explains: the wrong-kind flag never unlinks by itself. */
	.relink {
		padding: 0 0 0 2px;
		border: 0;
		border-radius: 0;
		background: transparent;
		color: var(--accent);
		font: inherit;
		text-decoration: underline;
		cursor: pointer;
	}
	.relink:disabled {
		opacity: 0.35;
	}
	/* FROM EP. (c350): the season's episode part 2 starts at, in its row. */
	.fromcell {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}
	.fromep {
		width: 4.5em;
		height: 28px;
		padding: 0 6px;
		border: 1px solid var(--text-1);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 400 13px var(--font-mono);
		caret-color: var(--accent);
		outline: none;
	}
	.fromnote {
		color: var(--text-2);
		text-wrap: pretty;
	}
	.searched {
		font: 400 13px/1.45 var(--font-mono);
		color: var(--text-2);
		text-wrap: pretty;
	}

	/* ---- the season (c240) ------------------------------------------------- */
	.seasonbar {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 4px 14px;
		padding: 14px var(--pad);
		border-bottom: 1px solid var(--line-1);
		background: var(--surface-panel);
	}
	.sb-a {
		font: 500 13px var(--font-mono);
		letter-spacing: 0.06em;
	}
	.sb-b,
	.sb-c {
		font: 400 12px var(--font-mono);
		color: var(--text-2);
		letter-spacing: 0.04em;
	}
	.sb-c {
		margin-left: auto;
	}
	.rels {
		display: flex;
		flex-direction: column;
		border-top: 1px solid var(--line-1);
	}
	.relnotes {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 10px var(--pad) 14px;
		font: 400 12px/1.4 var(--font-mono);
		color: var(--text-2);
	}
	.rellist {
		display: flex;
		flex-direction: column;
		border-top: 1px solid var(--line-1);
	}
	.rel {
		border-bottom: 1px solid var(--line-1);
	}
	.relbtn {
		display: flex;
		align-items: stretch;
		width: 100%;
		min-height: 64px;
		padding: 0;
		border: 0;
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		text-align: left;
		cursor: pointer;
	}
	.relbtn.on {
		background: var(--surface-panel);
	}
	.relbtn:disabled {
		cursor: default;
	}
	.rel.outside .relbtn {
		color: var(--text-2);
	}
	.tickcell {
		width: 44px;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		border-right: 1px solid var(--line-1);
		font: 500 15px var(--font-mono);
	}
	.rno {
		width: 64px;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		padding: 0 8px;
		border-right: 1px solid var(--line-1);
		font: 500 12px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.rtext {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 3px;
		padding: 10px 14px;
	}
	.rtitle {
		font: 500 14px/1.3 var(--font-sans);
	}
	.rmeta,
	.rwhy {
		font: 400 12px/1.35 var(--font-mono);
		color: var(--text-2);
	}
	.rwhy.ink {
		color: var(--text-1);
	}
	.relacts {
		display: flex;
		height: 60px;
		border-top: 1px solid var(--line-1);
		margin-top: auto;
	}
	.relacts button {
		flex: 1;
		border: 0;
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
		cursor: pointer;
	}
	.relacts button.strong {
		flex: 1.4;
		background: var(--accent);
		color: var(--on-accent);
	}
	.relacts button.first {
		border-right: 1px solid var(--line-1);
	}
	.relacts button.dim {
		color: var(--text-2);
		cursor: default;
	}
	.cands {
		flex: 1;
		min-width: 0;
	}
	@media (min-width: 1200px) {
		/* ---- the season (c240) ------------------------------------------------- */
		.seasonbar {
			display: flex;
			flex-wrap: wrap;
			align-items: baseline;
			gap: 4px 14px;
			padding: 14px var(--pad);
			border-bottom: 1px solid var(--line-1);
			background: var(--surface-panel);
		}
		.sb-a {
			font: 500 13px var(--font-mono);
			letter-spacing: 0.06em;
		}
		.sb-b,
		.sb-c {
			font: 400 12px var(--font-mono);
			color: var(--text-2);
			letter-spacing: 0.04em;
		}
		.sb-c {
			margin-left: auto;
		}
		.rels {
			display: flex;
			flex-direction: column;
			border-top: 1px solid var(--line-1);
		}
		.relnotes {
			display: flex;
			flex-direction: column;
			gap: 6px;
			padding: 10px var(--pad) 14px;
			font: 400 12px/1.4 var(--font-mono);
			color: var(--text-2);
		}
		.rellist {
			display: flex;
			flex-direction: column;
			border-top: 1px solid var(--line-1);
		}
		.rel {
			border-bottom: 1px solid var(--line-1);
		}
		.relbtn {
			display: flex;
			align-items: stretch;
			width: 100%;
			min-height: 64px;
			padding: 0;
			border: 0;
			border-radius: 0;
			background: transparent;
			color: var(--text-1);
			text-align: left;
			cursor: pointer;
		}
		.relbtn.on {
			background: var(--surface-panel);
		}
		.relbtn:disabled {
			cursor: default;
		}
		.rel.outside .relbtn {
			color: var(--text-2);
		}
		.tickcell {
			width: 44px;
			flex-shrink: 0;
			display: flex;
			align-items: center;
			justify-content: center;
			border-right: 1px solid var(--line-1);
			font: 500 15px var(--font-mono);
		}
		.rno {
			width: 64px;
			flex-shrink: 0;
			display: flex;
			align-items: center;
			padding: 0 8px;
			border-right: 1px solid var(--line-1);
			font: 500 12px var(--font-mono);
			letter-spacing: 0.04em;
		}
		.rtext {
			flex: 1;
			min-width: 0;
			display: flex;
			flex-direction: column;
			justify-content: center;
			gap: 3px;
			padding: 10px 14px;
		}
		.rtitle {
			font: 500 14px/1.3 var(--font-sans);
		}
		.rmeta,
		.rwhy {
			font: 400 12px/1.35 var(--font-mono);
			color: var(--text-2);
		}
		.rwhy.ink {
			color: var(--text-1);
		}
		.relacts {
			display: flex;
			height: 60px;
			border-top: 1px solid var(--line-1);
			margin-top: auto;
		}
		.relacts button {
			flex: 1;
			border: 0;
			border-radius: 0;
			background: transparent;
			color: var(--text-1);
			font: 500 14px var(--font-mono);
			letter-spacing: 0.04em;
			cursor: pointer;
		}
		.relacts button.strong {
			flex: 1.4;
			background: var(--accent);
			color: var(--on-accent);
		}
		.relacts button.first {
			border-right: 1px solid var(--line-1);
		}
		.relacts button.dim {
			color: var(--text-2);
			cursor: default;
		}
		.cands {
			min-height: 0;
			overflow-y: auto;
		}
	}
	.ch {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 24px var(--pad) 12px;
	}
	.grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 1px;
		background: var(--line-1);
		border-top: 1px solid var(--line-1);
		border-bottom: 1px solid var(--line-1);
	}
	@media (min-width: 1200px) {
		.grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	.cand {
		min-width: 0;
		display: flex;
		flex-direction: column;
		background: var(--surface-page);
		cursor: pointer;
		outline-offset: -2px;
	}
	.cand.on {
		background: var(--accent-select);
	}
	.cand.off {
		cursor: default;
	}
	.strip {
		display: flex;
		align-items: stretch;
		height: 44px;
		border-bottom: 1px solid var(--line-subtle);
	}
	.letter {
		width: 44px;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		border-right: 1px solid var(--line-subtle);
		font: 500 16px var(--font-mono);
	}
	.ids {
		flex: 1;
		display: flex;
		align-items: center;
		padding: 0 14px;
		min-width: 0;
		font: 400 13px/1.3 var(--font-mono);
		color: var(--text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.chip {
		display: flex;
		align-items: center;
		padding: 0 14px;
		font: 500 13px/1.2 var(--font-mono);
		letter-spacing: 0.06em;
		background: var(--accent);
		color: var(--on-accent);
		white-space: nowrap;
	}
	/* An equal title is marked, never preselected: the owner still presses LINK (c298). */
	.chip.exact {
		background: transparent;
		color: var(--text-2);
		border-left: 1px solid var(--line-subtle);
	}
	.open {
		display: flex;
		align-items: center;
		padding: 0 14px;
		border-left: 1px solid var(--line-subtle);
		color: var(--text-1);
		font: 500 13px/1.2 var(--font-mono);
		letter-spacing: 0.04em;
		white-space: nowrap;
		text-decoration: none;
	}
	.cb {
		display: flex;
		gap: 16px;
		padding: 16px var(--pad) 18px;
	}
	.ccover {
		position: relative;
		flex-shrink: 0;
		width: var(--cand-cover-w);
		aspect-ratio: 2 / 2.9;
		align-self: flex-start;
		overflow: hidden;
	}
	.cand.on .ccover {
		box-shadow: 0 0 0 3px var(--accent);
	}
	.cand.off .ccover {
		opacity: 0.4;
	}
	.ct {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.ctitle {
		font: 500 var(--cand-title) / 1.25 var(--font-sans);
		text-wrap: pretty;
	}
	.cand.faded .ctitle {
		color: var(--text-2);
	}
	.calts {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.why {
		font: 500 12px/1.4 var(--font-mono);
		letter-spacing: 0.04em;
		color: var(--text-2);
	}
	.cand.on .why {
		color: var(--accent);
	}
	.nothing {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 8px var(--pad) 20px;
		border-bottom: 1px solid var(--line-1);
	}
	.nothing p {
		margin: 0;
		max-width: 520px;
		font: 500 20px/1.3 var(--font-sans);
		text-wrap: pretty;
	}
	.hint {
		max-width: 560px;
		font: 400 13px/1.45 var(--font-mono);
		color: var(--text-2);
	}
	.field {
		display: flex;
		align-items: stretch;
		margin: 0 var(--pad);
		height: 56px;
		border: 1px solid var(--text-1);
	}
	.field input {
		flex: 1;
		min-width: 0;
		padding: 0 16px;
		border: 0;
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 400 16px var(--font-sans);
		caret-color: var(--accent);
		outline: none;
	}
	.field input.mono {
		font: 400 15px var(--font-mono);
	}
	.field input::placeholder {
		color: var(--text-2);
	}
	.go {
		display: flex;
		align-items: center;
		padding: 0 20px;
		border: 0;
		border-left: 1px solid var(--text-1);
		border-radius: 0;
		background: var(--surface-inverse);
		color: var(--text-inverse);
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
		cursor: pointer;
	}
	.go:disabled {
		opacity: 0.35;
	}
	.fnote {
		padding: 10px var(--pad) 0;
		font: 400 13px/1.45 var(--font-mono);
		color: var(--text-2);
		text-wrap: pretty;
	}
	.fnote.last {
		padding-bottom: 24px;
	}

	/* Tools and actions stay in reach at the foot, as the duplicates review's do. */
	.tools,
	.actions {
		flex-shrink: 0;
		display: grid;
		border-top: 1px solid var(--line-1);
		background: var(--surface-page);
	}
	.tools {
		grid-template-columns: 1fr 1fr;
		position: sticky;
		bottom: 64px;
	}
	.actions {
		position: sticky;
		bottom: 0;
	}
	.tools button,
	.actions button {
		padding: 6px 10px;
		border: 0;
		border-left: 1px solid var(--line-1);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 var(--act-font) var(--font-mono);
		letter-spacing: 0.06em;
		line-height: 1.25;
		cursor: pointer;
	}
	.tools button {
		min-height: 52px;
	}
	.actions button {
		min-height: 64px;
		padding: 8px 10px;
	}
	.tools button.first,
	.actions button.first {
		border-left: 0;
	}
	.actions button.strong {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.tools button.dim,
	.actions button.dim {
		opacity: 0.35;
		cursor: default;
	}
	.tools button:not(.dim):active,
	.actions button:not(.dim):active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	/* Ranobe Review: the cover a candidate can't show (1a), and nothing found (1d). */
	.ccover.noted {
		background: var(--surface-page);
		border: 1px solid var(--line-2);
	}
	.suggest {
		display: flex;
		align-items: stretch;
		min-height: 68px;
		border-bottom: 1px solid var(--line-1);
		opacity: 0.4;
	}
	.suggest .st {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 5px;
		padding: 10px var(--pad);
	}
	.suggest .sn {
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.suggest .sd {
		font: 400 13px/1.35 var(--font-mono);
		color: var(--text-2);
		text-wrap: pretty;
	}
	.suggest .sy {
		display: flex;
		align-items: center;
		padding: 0 20px;
		border-left: 1px solid var(--line-1);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
	}
	/* Live once the app account's token is there (card c72): the dimmed row, switched on. */
	.suggest.live {
		opacity: 1;
	}
	button.sy {
		border-top: 0;
		border-right: 0;
		border-bottom: 0;
		background: transparent;
		color: var(--text-1);
		cursor: pointer;
	}
	button.sy:disabled {
		opacity: 0.35;
		cursor: default;
	}
	button.sy:not(:disabled):active {
		background: var(--surface-panel);
	}

	/* THE SAME WORK FOR THESE? (Ranobe Review 1b), transcribed as the rest. */
	.sibs {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}
	.sibhead {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 24px var(--pad) 18px;
		background: var(--surface-panel);
		border-bottom: 1px solid var(--line-1);
	}
	.sibq {
		font: 500 13px/1.2 var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.siblead {
		font: 500 var(--title-size) / 1.25 var(--font-sans);
		text-wrap: pretty;
	}
	.sibwhy {
		font: 400 13px/1.45 var(--font-mono);
		color: var(--text-2);
		text-wrap: pretty;
	}
	.siblist {
		display: flex;
		flex-direction: column;
		border-top: 1px solid var(--line-1);
	}
	.sib {
		display: flex;
		align-items: stretch;
		min-height: 72px;
		padding: 0;
		border: 0;
		border-bottom: 1px solid var(--line-1);
		background: var(--surface-page);
		color: var(--text-1);
		text-align: left;
		cursor: pointer;
	}
	.sib.on {
		background: var(--accent-select);
	}
	.tickcell {
		width: 64px;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		border-right: 1px solid var(--line-1);
	}
	.tick {
		width: 28px;
		height: 28px;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--line-2);
		color: var(--on-accent);
		font: 500 15px var(--font-mono);
	}
	.sib.on .tick {
		border-color: var(--accent);
		background: var(--accent);
	}
	.sibcover {
		width: 40px;
		flex-shrink: 0;
		margin: 10px 0 10px 16px;
		aspect-ratio: 2 / 2.9;
		align-self: center;
	}
	.sibtext {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 4px;
		padding: 10px 16px;
	}
	.sibtitle {
		font: 500 15px/1.3 var(--font-sans);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sibmeta {
		font: 400 13px/1.3 var(--font-mono);
		color: var(--text-2);
	}
	.sibnotes {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 16px var(--pad) 24px;
		font: 400 13px/1.45 var(--font-mono);
		color: var(--text-2);
		text-wrap: pretty;
	}
</style>
