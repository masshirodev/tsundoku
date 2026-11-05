<script lang="ts">
	import { leave } from '$lib/motion';
	import { readLocal, writeLocal } from '$lib/settings/local';
	import type { Json } from '$lib/settings/catalog';
	import { onDestroy, onMount, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { backLink, goBackTo } from '$lib/back';
	import { resolve } from '$app/paths';
	import { enhance } from '$app/forms';
	import type Hls from 'hls.js';
	import { clock, isWatchedAt } from '$lib/library/anime';
	import { WatchClock } from '$lib/reader/reader';
	import {
		challengeScale,
		bufferedTo,
		cueAt,
		deviceLang,
		HIDE_MOUSE_MS,
		HIDE_TOUCH_MS,
		isTap,
		leftLabel,
		movedEnough,
		NEXT_COUNT_S,
		nextServer,
		offerNextAt,
		openAt,
		parseVtt,
		placeLabel,
		playingLabel,
		pictureClick,
		startTracks,
		type TrackChoice,
		RESUME_MS,
		seekFor,
		SKIP_ALONE_MS,
		SPEEDS,
		STALL_S,
		stallStep,
		SUB_SIZES,
		cleanVolume,
		verticalFraction,
		KEY_STEP,
		WHEEL_STEP,
		spriteTile,
		type Sprite,
		subtitlePx,
		type Cue,
		type SubSize
	} from '$lib/library/player';
	import { coverSrc, readHref } from '$lib/library/links';
	import { nearFrame, PREVIEW_DEBOUNCE_MS, previewQuality, StreamPreview } from './seek-preview';
	import { canPip, copyStyles, documentPip, moveBack, moveInto, srclang } from './pip';
	import Cover from '$lib/components/content/Cover.svelte';
	import { count as grouped, kindLabel, unitLabel } from '$lib/library/labels';
	import { kindVerb, type WorkEnd, type WorkNextPart } from '$lib/library/works';
	import { langName, langRow, matchLang, qualitiesLine, qualityName } from '$lib/library/streams';
	import { page } from '$app/state';
	import { offline } from '$lib/offline.svelte';
	import { keepEpisodesAhead } from '$lib/cache/device';
	import { SvelteSet } from 'svelte/reactivity';
	import { tv } from '$lib/device.svelte';
	import { focusScope, registerBack } from '$lib/focus';
	import { isFocusable } from '$lib/focus/dom';

	/**
	 * The player (doc/ANIME.md, "The player"; card c156): Index Player, Player
	 * States, Player Waiting. The reader's rule carries over -- the picture is
	 * the interface -- with the reader's chrome for a video: a 64px top bar, a
	 * scrubber over cells, and the one addition, −10 / pause / +10 in the
	 * middle. Streams come through tsundoku (/api/anime/episode/<id>/videos);
	 * HLS plays through hls.js where the browser has Media Source, natively
	 * where it plays HLS itself. Device layout is CSS (portrait puts the
	 * picture on top with the controls always shown); only what the player
	 * does is script.
	 */
	type Episode = {
		id: number;
		number: number;
		season: number | null;
		title: string;
		note: string;
		durationS: number | null;
		endingAt: number | null;
		/** Its picture's address, '' while it has none (c225). */
		thumb: string;
		available: boolean;
		readAt: number | null;
		lastPosition: number | null;
	};
	/** [lang] the code a cell shows and a choice keeps; [name] in full (c386). */
	type Track = { lang: string; name?: string; src: string };
	type Quality = {
		label: string;
		height: number | null;
		kind: 'hls' | 'file';
		src: string;
		audio: Track[];
		subtitles: Track[];
		/** A downloaded file's seek preview, once the workstation has made it (c385). */
		sprite?: Sprite | null;
	};
	type Server = { n: number; name: string; qualities: Quality[] };
	type Streams = {
		servers: Server[];
		intro: { start: number; end: number } | null;
		ending: { start: number; end: number } | null;
	};

	let {
		data
	}: {
		data: {
			series: { id: number; title: string; hidden: boolean };
			source: { id: string; name: string } | null;
			episodes: Episode[];
			index: number;
			incognito: boolean;
			/** A browsing record (doc/BROWSING.md): its preview, where + ADD posts. */
			record?: { preview: string | null } | null;
			/** What it starts in (card c171): the series', SETTINGS', the last choice. */
			player: { series: TrackChoice; defaults: TrackChoice; last: TrackChoice };
			/** The Work's next part, where the last episode ends (doc/WORKS.md, W6). */
			work?: WorkEnd | null;
		};
	} = $props();

	// One player per episode: the page keys it on the episode (+page.svelte), so
	// reading `data` once is right, and NEXT starts a player of its own.
	// svelte-ignore state_referenced_locally
	const { episodes, index } = data;
	const ep = episodes[index];
	const seasons = episodes.some((e) => e.season !== null);
	const ofSeason = episodes.filter((e) => e.season === ep.season).length;
	const next = episodes[index + 1] ?? null;
	const prev = episodes[index - 1] ?? null;
	/**
	 * The Work's next part (doc/WORKS.md, W6). At the last episode the up-next
	 * card the player already draws turns into this one, with the next part's
	 * own verb -- a Work of an anime and its manga says READ -- and no
	 * countdown: an episode's countdown never plays another series.
	 */
	// svelte-ignore state_referenced_locally
	const work = data.work ?? null;
	const workNext =
		work?.next && (work.mode === 'next' || work.mode === 'meanwhile') ? work.next : null;
	const workHref = work ? resolve('/work/[id]', { id: String(work.id) }) : '';
	const workStart = workNext?.entry
		? readHref(workNext.entry.id, 1)
		: workNext
			? resolve('/series/[id]', { id: String(workNext.seriesId) })
			: '';
	let workClosed = $state(false);
	const stateWord = (s: WorkNextPart['state']) =>
		s === 'not-started'
			? 'NOT STARTED'
			: s === 'in-progress'
				? 'IN PROGRESS'
				: s === 'caught-up'
					? 'CAUGHT UP'
					: 'READ';
	/** The next part's own line (Work-EndStates 3): "MANGA · 140 CH. · NOT STARTED". */
	const workMeta = workNext
		? `${kindLabel(workNext.kind)} · ${grouped(workNext.entries)} ${unitLabel(workNext.kind)}. · ${stateWord(workNext.state)}`
		: '';
	const upNext = episodes.slice(index + 1, index + 5);
	const leftInSeason = episodes.filter(
		(e, i) => i > index && e.season === ep.season && e.readAt === null
	).length;
	// svelte-ignore state_referenced_locally
	const seriesHref = resolve('/series/[id]', { id: String(data.series.id) });
	// svelte-ignore state_referenced_locally
	const moveHref = resolve('/series/[id]/move', { id: String(data.series.id) });
	const libraryHref = resolve('/');
	// svelte-ignore state_referenced_locally
	const failureLine = 'failures' in data ? (data.failures ?? null) : null;
	const place = placeLabel(ep, ofSeason, seasons);
	const epShort = (e: Episode) => `EP. ${e.number}`;
	const metaOf = (e: Episode) =>
		[e.note.toUpperCase(), e.durationS ? `${Math.round(e.durationS / 60)} MIN` : '']
			.filter(Boolean)
			.join(' · ');

	// ---- where it is ----------------------------------------------------------------------------
	type Phase =
		| 'resolving'
		| 'challenge'
		| 'playing'
		| 'noServer'
		| 'engine'
		| 'ended'
		/** Offline, and this episode isn't kept on the device (Player Waiting 3d). */
		| 'offline';
	let phase = $state<Phase>('resolving');
	let waited = $state(0);
	let checkingSince = $state<number | null>(null);
	let streams = $state<Streams | null>(null);
	let serverN = $state(1);
	let qualityIndex = $state(0);
	const failed = new SvelteSet<number>();
	let failedAt = $state<Record<number, number>>({});
	let freshTried = false;

	let video = $state<HTMLVideoElement | null>(null);
	let hls: Hls | null = null;
	let time = $state(0);
	/** The second a reload (a server, a quality, a fresh list) is heading for, until the video is there. */
	let reloadingTo: number | null = null;
	/** How far from that second hls.js may land (a segment's start) and still count as there. */
	const RELOAD_SLACK_S = 10;
	let duration = $state(ep.durationS ?? 0);
	let buffered = $state(0);
	let paused = $state(true);
	let stalled = $state<number | null>(null);
	let stallSeconds = $state(0);
	let serverNotice = $state<{ from: number; at: number } | null>(null);
	let qualityNotice = $state<{ from: string; to: string; at: number } | null>(null);

	const server = $derived(streams?.servers.find((s) => s.n === serverN) ?? null);
	const quality = $derived(server?.qualities[qualityIndex] ?? null);
	const order = $derived(streams?.servers.map((s) => s.n) ?? []);

	// ---- settings: audio and subtitles per series, kept on the workstation (card c171) ---------
	// The series' choice, else SETTINGS' default, else the last on any anime;
	// quality and dim per device, speed per episode.
	/** A choice made here counts for this series and, as the last one, for every other. */
	const choose = (what: 'audio' | 'subs' | 'subsize', v: string | null) => {
		void fetch(`/api/anime/series/${data.series.id}/choice`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ what, v }),
			// A pick and then ← at once: leaving the page cancels a plain request
			// still in flight, and the choice would go with it.
			keepalive: true
		}).catch(() => {
			// Offline: the choice lasts this episode.
		});
	};
	// Quality, dim and volume are this device's, stamped for the workstation's copy (settings/local.ts).
	const load = <T,>(k: string, fallback: T): T => readLocal(k, fallback);
	const save = (k: string, v: Json) => writeLocal(k, v);
	let audioLang = $state<string | null>(null);
	let subLang = $state<string | null>(null);
	let subSize = $state<SubSize>('M');
	let speed = $state(1);
	let dim = $state(0);
	let volume = $state(1);
	let muted = $state(false);
	let cues = $state<Cue[]>([]);
	const line = $derived(cueAt(cues, time));

	/** Where the pointer was, and where the controls last left it (c217). */
	let lastPointer: { x: number; y: number } | null = null;
	let moveAnchor: { x: number; y: number } | null = null;
	/**
	 * The controls come back on a move, not on a jitter: a mouse resting on a
	 * desk sends a pixel or two of movement all the time, and the chrome used
	 * to flash in on every one of them. A quick move from where the pointer
	 * was, or a slow one from where the controls left it, brings them back.
	 */
	function pointerMoved(e: PointerEvent) {
		if (e.pointerType !== 'mouse') return;
		mouse = true;
		const at = { x: e.clientX, y: e.clientY };
		const quick = !!lastPointer && movedEnough(lastPointer, at);
		const drift = !!moveAnchor && movedEnough(moveAnchor, at);
		lastPointer = at;
		if (chrome) {
			moveAnchor = at;
			showChrome();
			return;
		}
		if (quick || drift) {
			moveAnchor = null;
			showChrome();
		} else if (!moveAnchor) moveAnchor = at;
	}

	// ---- chrome --------------------------------------------------------------------------------
	let chrome = $state(true);
	let adding = $state(false);
	let added = $state(false);
	let sheet = $state(false);
	let keysOpen = $state(false);
	let resumedAt = $state<number | null>(null);
	let skipAlone = $state(true);
	let seekFlash = $state<{ by: number; to: number } | null>(null);
	let stay = $state(false);
	let count = $state(NEXT_COUNT_S);
	let mouse = $state(false);
	let hideTimer: ReturnType<typeof setTimeout> | undefined;

	function showChrome() {
		chrome = true;
		clearTimeout(hideTimer);
		if (!paused && !sheet)
			hideTimer = setTimeout(() => (chrome = false), mouse ? HIDE_MOUSE_MS : HIDE_TOUCH_MS);
	}

	// BACK (c235): the panel, then the bar, then the series -- which is the
	// screen's own Escape below, so the last step is not this function's.
	$effect(() =>
		registerBack(() => {
			if (keysOpen) {
				keysOpen = false;
				return true;
			}
			// MORE's list climbs before the sheet closes (c386).
			if (sheet && moreOf) {
				void closeMore();
				return true;
			}
			if (sheet) {
				sheet = false;
				return true;
			}
			if (chrome && phase === 'playing') {
				// On a TV only: elsewhere BACK was never the bar's (c235 keeps the
				// phone, tablet and desktop player as it was, Esc leaving it).
				if (!tv.current) return false;
				chrome = false;
				clearTimeout(hideTimer);
				return true;
			}
			return false;
		})
	);

	/**
	 * The panel's rows are redrawn when the playing server changes under it (a
	 * stream that fails over), and the row focus was on goes with them. A TV has
	 * nowhere else to be, so the panel takes focus back rather than dropping the
	 * mark to nothing (TV-Board-Player 6E).
	 */
	$effect(() => {
		if (!sheet) return;
		const panel = root?.querySelector<HTMLElement>('.sheet');
		if (!panel) return;
		const restore = (e: FocusEvent) => {
			if (e.relatedTarget) return;
			requestAnimationFrame(() => {
				if (document.activeElement !== document.body) return;
				panel.querySelector<HTMLElement>('[data-focus-start]')?.focus();
			});
		};
		panel.addEventListener('focusout', restore);
		return () => panel.removeEventListener('focusout', restore);
	});

	const inIntro = $derived(
		!!streams?.intro && time >= streams.intro.start && time < streams.intro.end
	);
	const inEnding = $derived(
		!!streams?.ending && time >= streams.ending.start && time < streams.ending.end - 1 && !next
	);
	const skip = $derived(inIntro ? 'SKIP INTRO →' : inEnding ? 'SKIP ENDING →' : null);
	// SKIP is the one thing shown without a tap: alone for 8 s, then with the controls only.
	let skipTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		if (!skip) return;
		skipAlone = true;
		clearTimeout(skipTimer);
		skipTimer = setTimeout(() => (skipAlone = false), SKIP_ALONE_MS);
		return () => clearTimeout(skipTimer);
	});
	const offerAt = $derived(
		duration ? offerNextAt(duration, streams?.ending?.start ?? null) : Infinity
	);
	const offering = $derived(phase === 'playing' && !!next && !stay && time >= offerAt);
	/** SKIP on screen: alone for its first seconds, then with the bar (c156). */
	const skipShown = $derived(!!skip && (chrome || skipAlone));
	const endcardShown = $derived(offering && !!next);
	/**
	 * The Work card takes the end card's place on the last episode, from the
	 * same moment the next-episode card would appear (its ending's start, or 30
	 * s before the end). It never counts down and never plays another series
	 * (doc/WORKS.md, W6).
	 */
	const workCardShown = $derived(
		!!workNext && !next && !workClosed && phase === 'playing' && time >= offerAt
	);
	/**
	 * The overlay a TV's pad starts on (c296), PLAY NOW over SKIP: both cannot
	 * be up today (`inEnding` stands down when there is a next), but an ending
	 * skip and PLAY NOW do the same thing and the card is the button the owner
	 * reaches for, so the card stays first if they ever can be.
	 */
	const overlay = $derived<'next' | 'skip' | 'work' | null>(
		endcardShown ? 'next' : workCardShown ? 'work' : skipShown ? 'skip' : null
	);
	/** The bar's ↑, when an overlay is up: back to the button it was left from (c296). */
	const focusUp = $derived(
		!tv.current || !overlay
			? undefined
			: overlay === 'next'
				? '[data-player-play]'
				: overlay === 'work'
					? '[data-player-work]'
					: '[data-player-skip]'
	);
	const marks = $derived(
		[streams?.intro, streams?.ending]
			.filter((r): r is { start: number; end: number } => !!r && duration > 0)
			.flatMap((r) => [r.start / duration, r.end / duration])
	);
	const playing = $derived(
		playingLabel({
			audio: quality?.audio.length ? (audioLang ?? quality.audio[0].lang) : null,
			subtitles: subLang,
			burnedIn: !!quality && quality.subtitles.length === 0,
			quality: quality ? qualityName(quality) : null,
			speed
		})
	);

	// ---- who a TV's keys are for (c296) ------------------------------------------------------------
	/** Whether the last thing focused was one of the overlay's buttons. */
	let overlayHadFocus = false;
	/** The offer that last took the pad, whether or not the chrome drew it. */
	let offered: 'next' | 'skip' | 'work' | null = null;

	function overlayButton(kind: 'next' | 'skip' | 'work'): HTMLElement | null {
		const selector =
			kind === 'next'
				? '[data-player-play]'
				: kind === 'work'
					? '[data-player-work]'
					: '[data-player-skip]';
		return root?.querySelector<HTMLElement>(selector) ?? null;
	}

	function onFocusIn(e: FocusEvent): void {
		overlayHadFocus = e.target instanceof Element && !!e.target.closest('.endcard, .skip, .upn');
	}

	/**
	 * The offer as it *exists*, not as the chrome draws it (c296, round 2): a
	 * SKIP inside its 8 s alone window shows without the bar, and one whose
	 * window has closed shows only with it, so keying the auto-focus on what is
	 * on screen moved the mark every time the bar was revealed -- off the ▶❚❚
	 * the owner had just asked for. The offer takes the pad when it starts; a
	 * bar that reveals an offer already running leaves focus where it is.
	 */
	const offer = $derived<'next' | 'skip' | 'work' | null>(
		endcardShown ? 'next' : workCardShown ? 'work' : skip ? 'skip' : null
	);

	/**
	 * PLAY NOW, and SKIP, take focus the moment they are offered on a TV (c296):
	 * OK then does the thing the card offers, in one press. Only a TV, never a
	 * pointer, never over an open sheet. An owner already on the button keeps
	 * it, and PLAY NOW wins over SKIP when both could be up (see `overlay`).
	 */
	$effect(() => {
		const kind = offer;
		const was = offered;
		offered = kind;
		if (!kind || kind === was || !tv.current || sheet || keysOpen) return;
		void tick().then(() => {
			if (offer !== kind || sheet || keysOpen) return;
			const wanted = overlayButton(kind);
			const active = document.activeElement;
			if (!wanted || active === wanted) return;
			// A sheet opened in the same breath keeps the pad: its scope owns it.
			if (active instanceof Element && active.closest('[role="dialog"]')) return;
			wanted.focus({ preventScroll: true });
		});
	});

	/**
	 * The chrome's own 4 s (HIDE_TOUCH_MS) must not strand the pad on a cell it
	 * has just hidden (c296, round 2): with the card or SKIP up, `.top` and
	 * `.bottom` are `data-focus-skip`, so a cell focused there is no stop any
	 * more -- every arrow runs the layer's "nothing focused" path (STAY) and OK
	 * clicks the track, which has nothing to do. While an offer is up the offer
	 * keeps the pad; the picture does not take it back.
	 */
	$effect(() => {
		if (!tv.current || chrome || !overlay) return;
		void tick().then(() => {
			if (!tv.current || chrome || !overlay) return;
			const active = document.activeElement;
			if (!(active instanceof HTMLElement) || active === document.body) return;
			if (active.closest('.endcard, .skip, .upn')) return;
			if (isFocusable(active)) return;
			overlayButton(overlay)?.focus({ preventScroll: true });
		});
	});

	/**
	 * When the card or SKIP goes away (STAY, a skip, the mark passed, the
	 * alone window closing), focus lands somewhere real: the seek bar when it
	 * is shown, else nothing -- and the picture keeps the keys. Never on the
	 * node that was removed (c296).
	 */
	$effect(() => {
		if (!tv.current || overlay !== null || !overlayHadFocus) return;
		overlayHadFocus = false;
		if (chrome) scrub?.focus({ preventScroll: true });
		else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
	});

	// ---- resolving --------------------------------------------------------------------------------
	let waitTimer: ReturnType<typeof setInterval> | undefined;
	let checkTimer: ReturnType<typeof setInterval> | undefined;

	async function resolveVideos(fresh: boolean): Promise<Streams | 'down' | 'none'> {
		phase = 'resolving';
		waited = 0;
		checkingSince = null;
		const started = Date.now();
		clearInterval(waitTimer);
		waitTimer = setInterval(() => (waited = Math.round((Date.now() - started) / 1000)), 1000);
		// A site's check is named at once (Browse Calls), not after ten seconds.
		if (data.source)
			checkTimer = setInterval(async () => {
				try {
					const r = await fetch(resolve('/api/browse/check/[source]', { source: data.source!.id }));
					const since = r.ok ? ((await r.json()) as { since: number | null }).since : null;
					checkingSince = since;
					if (since !== null && phase === 'resolving') phase = 'challenge';
				} catch {
					// Quiet: the wait says what it can.
				}
			}, 1000);
		try {
			const r = await fetch(
				`${resolve('/api/anime/episode/[entry]/videos', { entry: String(ep.id) })}${fresh ? '?fresh=1' : ''}`
			);
			if (r.status === 503) {
				const j = (await r.json().catch(() => ({}))) as { failed?: string };
				return j.failed === 'down' ? 'down' : 'none';
			}
			if (!r.ok) return 'none';
			const s = (await r.json()) as Streams;
			return s.servers.length ? s : 'none';
		} catch {
			return 'down';
		} finally {
			clearInterval(waitTimer);
			clearInterval(checkTimer);
		}
	}

	// What this device keeps (doc/ANIME.md, "Offline"): the episodes of this series cached on it.
	const cached = $derived(new Set(offline.entries[data.series.id] ?? []));
	const playable = (e: Episode | null) => !!e && (offline.online || cached.has(e.id));

	async function start(fresh = false, at?: number) {
		const got = await resolveVideos(fresh);
		// Offline, whatever didn't come is an episode the device doesn't keep.
		if (typeof got === 'string' && !offline.online) return void (phase = 'offline');
		if (got === 'down') return void (phase = 'engine');
		if (got === 'none') return void (phase = 'noServer');
		streams = got;
		failed.clear();
		failedAt = {};
		serverN = got.servers[0].n;
		qualityIndex = startIndex(got.servers[0]);
		phase = 'playing';
		keepNext();
		await tick();
		// The ending the resolve just found is the one watching counts from, even
		// before the page's own data has it (c239).
		const open =
			at === undefined
				? openAt({
						...ep,
						durationS: duration || ep.durationS,
						endingAt: got.ending?.start ?? ep.endingAt
					})
				: null;
		attach(at ?? open!.at);
		if (open?.resumed) {
			resumedAt = open.at;
			setTimeout(() => (resumedAt = null), RESUME_MS);
		}
	}

	/** The quality this device starts on (Anime Calls 01): its own choice, else the best, 720 on a phone. */
	function startIndex(s: Server): number {
		const want = load<number | null>('tsundoku:anime:quality', null);
		const phone = matchMedia('(max-width: 599px), (max-height: 499px)').matches;
		const cap = want ?? (phone ? 720 : null);
		if (cap === null) return 0;
		const i = s.qualities.findIndex((q) => q.height !== null && q.height <= cap);
		return i >= 0 ? i : s.qualities.length - 1;
	}

	// ---- playing -----------------------------------------------------------------------------------
	async function attach(at: number) {
		if (!video || !quality) return;
		reloadingTo = at;
		detach();
		const src = quality.src;
		const { default: HlsClass } = await import('hls.js');
		// A file a hoster links to plays as it is; HLS through hls.js, or the browser's own.
		if (quality.kind === 'hls' && HlsClass.isSupported()) {
			const h = new HlsClass({ startPosition: at, maxBufferLength: 60 });
			hls = h;
			h.on(HlsClass.Events.ERROR, (_e, d) => {
				if (d.fatal) fail();
			});
			h.on(HlsClass.Events.AUDIO_TRACKS_UPDATED, () => pickAudio());
			h.loadSource(src);
			h.attachMedia(video);
		} else {
			video.src = src;
			video.currentTime = at;
		}
		video.playbackRate = speed;
		void video.play().catch(() => (paused = true));
		void loadSubtitles();
	}

	function detach() {
		hls?.destroy();
		hls = null;
	}

	function pickAudio() {
		if (!hls || !quality?.audio.length) return;
		const want = audioLang ?? quality.audio[0].lang;
		const i = hls.audioTracks.findIndex(
			(t) => (t.name ?? '').toUpperCase() === want || (t.lang ?? '').toUpperCase() === want
		);
		if (i >= 0) hls.audioTrack = i;
	}

	async function loadSubtitles() {
		cues = [];
		const track = quality?.subtitles.find((t) => t.lang === subLang) ?? null;
		if (!track) return;
		try {
			const r = await fetch(track.src);
			if (r.ok) cues = parseVtt(await r.text());
		} catch {
			// No subtitles this time; the picture still plays.
		}
	}

	/**
	 * Where the episode is: the second a reload is heading for while there is
	 * one. Destroying hls.js empties the video, whose currentTime reads 0 until
	 * the new stream is in, and a server that stopped twice in a row would
	 * otherwise start the episode over.
	 */
	const position = () => reloadingTo ?? video?.currentTime ?? time;

	/** A server that stopped: the next at the same second, by itself; only the last failure stops playback. */
	async function fail() {
		const at = position();
		failed.add(serverN);
		failedAt = { ...failedAt, [serverN]: at };
		const to = nextServer(order, serverN, failed);
		if (to !== null) {
			serverNotice = { from: serverN, at };
			setTimeout(() => (serverNotice = null), 4000);
			switchServer(to, at);
			return;
		}
		// Its address may simply have gone stale: the list is asked for afresh once.
		detach();
		if (!freshTried) {
			freshTried = true;
			await start(true, at);
			return;
		}
		phase = 'noServer';
	}

	function switchServer(n: number, at = position()) {
		const s = streams?.servers.find((x) => x.n === n);
		if (!s) return;
		const height = quality?.height ?? null;
		serverN = n;
		const same = s.qualities.findIndex((q) => q.height === height);
		qualityIndex = same >= 0 ? same : 0;
		stalled = null;
		void tick().then(() => attach(at));
	}

	/**
	 * A stall with no server left to move to: one quality down on this server,
	 * at the same second. This episode's only: the next starts on the
	 * device's choice again, since the link may be fine by then.
	 */
	function stepDown(i: number) {
		const s = server;
		if (!s?.qualities[i]) return;
		const at = position();
		qualityNotice = {
			from: quality ? qualityName(quality) : '',
			to: qualityName(s.qualities[i]),
			at
		};
		setTimeout(() => (qualityNotice = null), 4000);
		qualityIndex = i;
		stalled = null;
		void tick().then(() => attach(at));
	}

	/** What a stall on what's playing now would move to (the BUFFERING panel names it). */
	const stallNext = () =>
		stallStep(
			order,
			serverN,
			failed,
			(server?.qualities ?? []).map((q) => q.height),
			qualityIndex
		);

	function setQuality(i: number) {
		qualityIndex = i;
		save('tsundoku:anime:quality', server?.qualities[i]?.height ?? null);
		void tick().then(() => attach(position()));
	}

	// The stall clock: a buffer that doesn't fill for 15 s moves to the next server.
	let stallTimer: ReturnType<typeof setInterval> | undefined;
	function onWaiting() {
		if (stalled !== null) return;
		stalled = Date.now();
		stallSeconds = 0;
		clearInterval(stallTimer);
		stallTimer = setInterval(() => {
			if (stalled === null) return clearInterval(stallTimer);
			stallSeconds = Math.round((Date.now() - stalled) / 1000);
			if (stallSeconds >= STALL_S) {
				clearInterval(stallTimer);
				stalled = null;
				const step = stallNext();
				if (step && 'quality' in step) stepDown(step.quality);
				else void fail();
			}
		}, 500);
	}
	function onProgressing() {
		stalled = null;
		clearInterval(stallTimer);
	}

	// ---- progress: watching is reading --------------------------------------------------------------
	let opened = false;
	let finished = ep.readAt !== null;
	let lastSent = 0;
	/**
	 * What played, for the log's `duration_ms` (card c443; doc/READING-LOG.md).
	 * Only time actually playing counts: paused, buffering, a seek and a hidden
	 * page are not watching (WatchClock). A picture in a floating window is.
	 */
	const watch = new WatchClock();
	async function send(kind: 'open' | 'page' | 'finish' | 'close') {
		if (data.incognito) return;
		const durationMs = kind === 'open' ? 0 : watch.lap();
		const body = JSON.stringify({
			seriesId: data.series.id,
			entryId: ep.id,
			kind,
			page: Math.max(0, Math.floor(time)),
			...(duration > 0 ? { length: Math.round(duration) } : {}),
			durationMs,
			at: Date.now()
		});
		if (kind === 'close') {
			navigator.sendBeacon?.(
				resolve('/api/reading'),
				new Blob([body], { type: 'application/json' })
			);
			return;
		}
		try {
			await fetch(resolve('/api/reading'), {
				method: 'POST',
				body,
				headers: { 'content-type': 'application/json' },
				keepalive: true
			});
		} catch {
			// Kept by the next one: positions only move forward.
		}
	}

	const rangesOf = (b: TimeRanges): [number, number][] =>
		Array.from({ length: b.length }, (_, i) => [b.start(i), b.end(i)]);

	/**
	 * The file's own length, as soon as it is known: the episode's stored one
	 * is a catalogue's figure, and before the first timeupdate a seek on the
	 * scrubber went by it (c387: a paused 8 s clip, tapped at its middle, went
	 * to 720 s of a stored 24 minutes, clamped to the end).
	 */
	function onDuration() {
		if (video && Number.isFinite(video.duration) && video.duration > 0) duration = video.duration;
	}
	function onTime() {
		if (!video) return;
		// Mid-reload the emptied video says 0: neither shown nor sent, or a
		// stream that stopped and never came back wiped the episode's place.
		if (reloadingTo !== null) {
			if (video.readyState < 2 || Math.abs(video.currentTime - reloadingTo) > RELOAD_SLACK_S)
				return;
			reloadingTo = null;
		}
		time = video.currentTime;
		watch.tick(Date.now(), time, {
			rate: video.playbackRate,
			watching:
				!video.paused &&
				!video.seeking &&
				(document.visibilityState === 'visible' || inDocPip || inNativePip)
		});
		if (Number.isFinite(video.duration) && video.duration > 0) duration = video.duration;
		buffered = bufferedTo(rangesOf(video.buffered), time);
		if (!opened && time > 0) {
			opened = true;
			void send('open');
		}
		if (opened && Date.now() - lastSent > 15_000) {
			lastSent = Date.now();
			void send('page');
		}
		if (!finished && duration > 0 && isWatchedAt(time, duration, streams?.ending?.start ?? null)) {
			finished = true;
			void send('finish');
		}
	}

	function onEnded() {
		if (!finished) {
			finished = true;
			void send('finish');
		}
		phase = 'ended';
		// It never plays by itself into an episode that can't play (Anime Calls 01, default 4).
		if (next && !stay && playable(next)) runCount();
	}

	/**
	 * While an episode plays, the device keeps the next one if it's downloaded
	 * (Anime Calls 01, default 5). Nothing of a hidden series, nothing while
	 * reveal is on, nothing incognito: those leave nothing behind.
	 */
	function keepNext() {
		if (data.series.hidden || data.incognito || page.data.reveal) return;
		void keepEpisodesAhead(
			data.series.id,
			episodes.map((e, i) => ({
				id: e.id,
				position: i,
				readAt: e.id === ep.id && finished ? Date.now() : e.readAt,
				available: e.available
			})),
			ep.id
		).catch(() => undefined);
	}

	let countTimer: ReturnType<typeof setInterval> | undefined;
	function runCount() {
		count = NEXT_COUNT_S;
		clearInterval(countTimer);
		countTimer = setInterval(() => {
			count -= 1;
			if (count <= 0) {
				clearInterval(countTimer);
				playNext();
			}
		}, 1000);
	}
	function stayHere() {
		stay = true;
		clearInterval(countTimer);
	}
	function playNext() {
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- readHref() resolves
		if (next) void goto(readHref(next.id), { replaceState: true });
	}
	function playPrev() {
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- readHref() resolves
		if (prev) void goto(readHref(prev.id), { replaceState: true });
	}

	// ---- controls ------------------------------------------------------------------------------------
	function toggle() {
		if (!video) return;
		if (video.paused) void video.play();
		else video.pause();
		showChrome();
	}
	function seek(by: number) {
		if (!video) return;
		reloadingTo = null;
		video.currentTime = Math.max(0, Math.min(duration || Infinity, video.currentTime + by));
		time = video.currentTime;
	}
	/** The seek the bar and the media keys show: the flash names the move (c296). */
	function seekWithFlash(by: number) {
		seek(by);
		seekFlash = { by, to: time };
		clearTimeout(flashTimer);
		flashTimer = setTimeout(() => (seekFlash = null), 900);
		showChrome();
	}
	/** ←/→: the track is a slider and flashes; the picture's own seek stays quiet. */
	function seekArrow(by: number) {
		// Either track: the bar's, or portrait's under the picture (c387).
		if (document.activeElement instanceof HTMLElement && document.activeElement.matches('.track'))
			seekWithFlash(by);
		else seek(by);
	}
	function skipNow() {
		if (!video) return;
		const skippingEnding = !inIntro && !!streams?.ending;
		const r = inIntro ? streams?.intro : streams?.ending;
		if (r) video.currentTime = r.end;
		// SKIP ENDING is the owner's other way of finishing an episode (c239):
		// the episode counts as watched the moment it is pressed, not only when
		// the seek's next timeupdate happens to land.
		if (skippingEnding && !finished) {
			finished = true;
			void send('finish');
		}
	}
	function fromStart() {
		reloadingTo = null;
		if (video) video.currentTime = 0;
		resumedAt = null;
	}

	let scrub = $state<HTMLElement | null>(null);
	let hoverAt = $state<number | null>(null);
	/**
	 * The line's box, not the element's: on a TV the track carries a
	 * transparent left border so ↑ from ▶❚❚ can reach it (c296), and the line
	 * starts after it. Nothing points at a TV, so no click lands in that border
	 * (c315); everywhere else `clientLeft` is 0.
	 */
	function scrubBox(el: HTMLElement): { left: number; width: number } {
		const box = el.getBoundingClientRect();
		return { left: box.left + el.clientLeft, width: el.clientWidth };
	}
	/**
	 * Where on the timeline a pointer is, 0 to 1, measured on the track it is
	 * over. There are two tracks, the bar's and portrait's (c387), and only one
	 * is drawn at a time: the hidden one's box is 0 wide, so the event's own
	 * track is the one to measure, never a ref to either.
	 */
	function scrubFraction(e: PointerEvent): number | null {
		const box = scrubBox(e.currentTarget as HTMLElement);
		if (!box.width) return null;
		return Math.max(0, Math.min(1, (e.clientX - box.left) / box.width));
	}
	function scrubTo(e: PointerEvent) {
		const f = scrubFraction(e);
		if (f === null || !video || !duration) return;
		reloadingTo = null;
		video.currentTime = f * duration;
		time = video.currentTime;
	}
	function scrubDown(e: PointerEvent) {
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		// A finger has no hover: its tip shows from the press, the time it sought,
		// and goes with the lift (a touch's pointerleave follows its pointerup).
		if (e.pointerType !== 'mouse') {
			const f = scrubFraction(e);
			if (f !== null && duration) {
				hoverAt = f * duration;
				wantPreview(hoverAt);
			}
		}
		scrubTo(e);
	}
	function scrubMove(e: PointerEvent) {
		const f = scrubFraction(e);
		if (f === null || !duration) return;
		hoverAt = f * duration;
		wantPreview(hoverAt);
		if (e.buttons & 1) scrubTo(e);
	}

	// ---- the seek preview (c385; doc/ANIME.md, "The player") ------------------------------------
	// A downloaded episode shows its sprite's tile in the tip, once the
	// workstation has cut it; until then, and for a downloaded episode always,
	// the time alone. A stream shows a frame of its own lowest quality, read by
	// a hidden second picture only while the pointer is on the bar (seek-preview.ts).
	const sprite = $derived<Sprite | null>(quality?.sprite ?? null);
	let preview: StreamPreview | null = null;
	let previewOf = '';
	let previewTimer: ReturnType<typeof setTimeout> | undefined;
	let previewAsk = 0;
	/** A stream's last frame, and the time it was drawn for: shown only near it (`nearFrame`). */
	let streamPic = $state<{ src: string; at: number } | null>(null);
	function wantPreview(at: number) {
		// The downloaded server (0) has a file: its sprite, or nothing to fetch.
		if (sprite || !server || server.n === 0) return;
		const q = previewQuality(server.qualities);
		if (!q) return;
		clearTimeout(previewTimer);
		previewTimer = setTimeout(async () => {
			if (!preview || previewOf !== q.src) {
				preview?.destroy();
				const { default: HlsClass } = await import('hls.js');
				preview = new StreamPreview(q, HlsClass);
				previewOf = q.src;
			}
			const ask = ++previewAsk;
			const pic = await preview.frameAt(at);
			// A later stop, or the pointer gone: this one is nobody's now.
			if (ask !== previewAsk || hoverAt === null) return;
			streamPic = pic ? { src: pic, at } : null;
		}, PREVIEW_DEBOUNCE_MS);
	}
	// ---- picture-in-picture (c388; doc/ANIME.md, "The player"; pip.ts) ------------------------
	let stage = $state<HTMLElement | null>(null);
	let pipWin: Window | null = null;
	/** The picture layer is in a Document Picture-in-Picture window. */
	let inDocPip = $state(false);
	/** The <video> alone is in the browser's own picture-in-picture: the native track shows. */
	let inNativePip = $state(false);
	let pipable = $state(false);
	/** The subtitles chosen, as a native track for the browser's own PiP to draw. */
	const pipTrack = $derived(quality?.subtitles.find((t) => t.lang === subLang) ?? null);
	let trackEl = $state<HTMLTrackElement | null>(null);
	$effect(() => {
		// Showing always, for whichever PiP window reads it, whether or not
		// the browser says it opened; drawn invisibly on the page (`cueless`)
		// except while it says its PiP has the picture (pip.ts).
		const el = trackEl;
		if (el?.track) el.track.mode = 'showing';
	});
	/**
	 * PIP: the picture layer into a floating window of its own, where Document
	 * Picture-in-Picture exists, else the <video> into the browser's own. A
	 * second press brings it back.
	 */
	async function pip() {
		if (pipWin) {
			closePip();
			return;
		}
		if (document.pictureInPictureElement) {
			await document.exitPictureInPicture().catch(() => undefined);
			return;
		}
		const api = documentPip();
		if (api && stage) {
			const box = stage.getBoundingClientRect();
			let w: Window;
			try {
				w = await api.requestWindow({
					width: Math.max(320, Math.round(box.width / 2)),
					height: Math.max(180, Math.round(box.height / 2))
				});
			} catch {
				return;
			}
			copyStyles(document, w.document);
			w.document.title = document.title;
			moveInto(w, stage);
			pipWin = w;
			inDocPip = true;
			pipInputOff = pipInput(w);
			// The window's own close button, or the browser closing it: the picture comes back.
			w.addEventListener('pagehide', putBack, { once: true });
			return;
		}
		if (video && canPip()) await video.requestPictureInPicture().catch(() => undefined);
	}
	/** The browser's own PiP opening and closing on the <video> (its own button, or PIP). */
	function nativePipEvents(el: HTMLVideoElement) {
		const on = () => (inNativePip = true);
		const off = () => (inNativePip = false);
		el.addEventListener('enterpictureinpicture', on);
		el.addEventListener('leavepictureinpicture', off);
		return () => {
			el.removeEventListener('enterpictureinpicture', on);
			el.removeEventListener('leavepictureinpicture', off);
		};
	}
	let pipInputOff: (() => void) | null = null;
	/**
	 * The floating window's own input (round 2 of c388). The tapzone's
	 * pointer handlers are Svelte's delegated ones, whose one listener is on
	 * the page's root, and the keys are the page's window: neither hears the
	 * floating window's document. So the window gets native listeners of its
	 * own, removed when the picture comes back: a click on the picture plays
	 * or pauses as it does on the page, and the player's keys work with the
	 * window focused, except Escape, which brings the picture back rather
	 * than leaving the page behind it.
	 */
	function pipInput(w: Window): () => void {
		// Not `instanceof w.Element`: a node moved in keeps the page's prototypes.
		const zoneOf = (e: Event) =>
			((e.target as Element | null)?.closest?.('.tapzone') as HTMLElement | null) ?? null;
		const down = (e: PointerEvent) => {
			if (zoneOf(e)) pressed = { x: e.clientX, y: e.clientY };
		};
		const up = (e: PointerEvent) => {
			const zone = zoneOf(e);
			if (zone) pictureTap(e, zone);
		};
		const key = (e: KeyboardEvent) => {
			if (e.key === 'Escape' && !keysOpen && !sheet) {
				e.preventDefault();
				closePip();
			} else keydown(e);
		};
		w.document.addEventListener('pointerdown', down);
		w.document.addEventListener('pointerup', up);
		w.addEventListener('keydown', key);
		return () => {
			w.document.removeEventListener('pointerdown', down);
			w.document.removeEventListener('pointerup', up);
			w.removeEventListener('keydown', key);
		};
	}
	/** The picture layer back in its place: the player's first child, as the markup has it. */
	function putBack() {
		pipInputOff?.();
		pipInputOff = null;
		if (stage && root) moveBack(root, stage);
		pipWin = null;
		inDocPip = false;
	}
	/** Every door out of PiP: PIP again, NEXT, leaving the page. Never a dead window. */
	function closePip() {
		const w = pipWin;
		putBack();
		w?.close();
	}

	/** The pointer left the bar (a touch's lift too): nothing more is fetched or shown. */
	function leaveScrub() {
		hoverAt = null;
		clearTimeout(previewTimer);
		previewAsk++;
		preview?.leave();
		streamPic = null;
	}

	// Taps on the picture: on a touch screen one shows or hides the controls,
	// and two on a side third seek 10 s, each further tap 10 more (Anime Calls,
	// "The picture is the interface"). On a mouse a click plays or pauses, and
	// the controls come back by moving the pointer past a threshold (c217,
	// c218): neither a jitter nor a drag is a click.
	let taps: {
		side: -1 | 0 | 1;
		n: number;
		at: number;
		timer?: ReturnType<typeof setTimeout>;
	} | null = null;
	let flashTimer: ReturnType<typeof setTimeout> | undefined;
	/** Where the press began: a pointer that wandered is a drag, not a click. */
	let pressed: { x: number; y: number } | null = null;
	function pictureTap(e: PointerEvent, zone = e.currentTarget as HTMLElement) {
		const kind = e.pointerType === 'mouse' ? 'mouse' : 'touch';
		if (kind === 'mouse') {
			mouse = true;
			if (e.button !== 0) return;
		}
		const at = { x: e.clientX, y: e.clientY };
		const tap = isTap(pressed, at);
		pressed = null;
		if (!tap) return;
		const box = zone.getBoundingClientRect();
		const x = (at.x - box.left) / box.width;
		const side: -1 | 0 | 1 = x < 1 / 3 ? -1 : x > 2 / 3 ? 1 : 0;
		const now = Date.now();
		if (taps && now - taps.at < 320 && taps.side === side && side !== 0) {
			clearTimeout(taps.timer);
			taps.n += 1;
			taps.at = now;
			const before = taps.n === 2 ? 0 : seekFor(taps.n - 1);
			seek(side * (seekFor(taps.n) - before));
			seekFlash = { by: side * seekFor(taps.n), to: time };
			clearTimeout(flashTimer);
			flashTimer = setTimeout(() => (seekFlash = null), 900);
			taps.timer = setTimeout(() => (taps = null), 320);
			return;
		}
		taps = { side, n: 1, at: now };
		const does = pictureClick(kind);
		// A click in the middle is never the first of a seek, so it acts at once;
		// on a side third it waits out the double, which seeks instead.
		const act = () => {
			taps = null;
			if (does === 'toggle') toggle();
			else if (chrome && !paused) {
				chrome = false;
				clearTimeout(hideTimer);
			} else showChrome();
		};
		if (does === 'toggle' && side === 0) act();
		else taps.timer = setTimeout(act, 320);
	}

	function keydown(e: KeyboardEvent) {
		// A TV's remote sends these (doc/TV.md), and they are harmless where
		// nothing does: the same verb as the control it names, on every device.
		const media =
			e.key === 'MediaPlayPause'
				? 'toggle'
				: e.key === 'MediaFastForward'
					? 'forward'
					: e.key === 'MediaRewind'
						? 'back'
						: e.key === 'MediaTrackNext'
							? 'next'
							: e.key === 'MediaTrackPrevious'
								? 'prev'
								: null;
		if (media) {
			e.preventDefault();
			if (media === 'toggle') toggle();
			else if (media === 'forward') seekWithFlash(10);
			else if (media === 'back') seekWithFlash(-10);
			else if (media === 'next' && next && playable(next)) playNext();
			else if (media === 'prev' && prev) playPrev();
			return;
		}

		if (keysOpen || sheet) {
			// BACK closes MORE's list before the sheet (c386), and gives MORE its focus back.
			if (e.key === 'Escape' && moreOf) closeMore();
			else if (e.key === 'Escape') keysOpen = sheet = false;
			return;
		}
		const k = e.key;
		// ← → between STAY and PLAY NOW belong to the focus layer while the
		// card has focus; the picture's seek must not also fire (c296).
		if (
			(k === 'ArrowLeft' || k === 'ArrowRight') &&
			document.activeElement instanceof Element &&
			document.activeElement.closest('.endcard')
		)
			return;
		// On a TV the picture is the interface (TV-Board-Player 6A). With the
		// bar hidden a key brings it: OK, ↑ or ↓ on ▶❚❚; ← → seek and then
		// keep seeking on the bar itself (c296). While a card or SKIP is up the
		// focus layer owns their arrows and OK, so this branch only takes ↓
		// into the bar (their buttons have no stop below them).
		if (
			tv.current &&
			!chrome &&
			(k === 'Enter' ||
				k === 'ArrowUp' ||
				k === 'ArrowDown' ||
				k === 'ArrowLeft' ||
				k === 'ArrowRight')
		) {
			e.preventDefault();
			// The Work card (`.upn`) is an offer too (c517): measured on a Work's
			// last episode, ↓ and ↑ from it brought the bar on ▶❚❚ instead.
			const onOverlay =
				document.activeElement instanceof HTMLElement &&
				!!document.activeElement.closest('.endcard, .skip, .upn');
			if (k === 'Enter' && skip && skipAlone && !onOverlay) skipNow();
			else if (k === 'ArrowLeft' || k === 'ArrowRight') {
				// Part 2: the seek comes with the bar, and the bar keeps the keys.
				seekWithFlash(k === 'ArrowLeft' ? -10 : 10);
				scrub?.focus({ preventScroll: true });
			} else if ((k === 'ArrowDown' || k === 'ArrowUp') && onOverlay) {
				// ↓ out of the card (PLAY NOW's or the Work's, or SKIP) is into the bar; the owner is on the
				// controls now, so the bar comes with it (c296). ↑ has nothing
				// above it, so the offer keeps the pad rather than opening the bar
				// underneath it and taking the focus back off the button.
				if (k === 'ArrowDown') {
					showChrome();
					scrub?.focus({ preventScroll: true });
				}
			} else {
				// 6A/6B: the key brings the bar and puts focus on ▶❚❚, so the next
				// press is the one that acts.
				showChrome();
				barStart()?.focus();
			}
			return;
		}
		if (k === ' ') toggle();
		else if (k === 'ArrowLeft') seekArrow(-10);
		else if (k === 'ArrowRight') seekArrow(10);
		else if (k === 'ArrowUp') setVolume(volume + KEY_STEP);
		else if (k === 'ArrowDown') setVolume(volume - KEY_STEP);
		else if (k === 'f' || k === 'F') void full();
		else if (k === 'm' || k === 'M') setMuted(!muted);
		else if (k === 'c' || k === 'C') setSub(subLang ? null : (quality?.subtitles[0]?.lang ?? null));
		else if ((k === 's' || k === 'S') && skip) skipNow();
		else if ((k === 'n' || k === 'N') && next) playNext();
		else if (k === '?') keysOpen = true;
		else if (k === 'Escape') {
			if (document.fullscreenElement) void document.exitFullscreen();
			else goBackTo(seriesHref);
		} else return;
		e.preventDefault();
		showChrome();
	}

	const VOLUME_KEY = 'tsundoku:anime:volume';
	/**
	 * The one door every volume change goes through (c385): the slider, the
	 * wheel and ↑ ↓. The level is this device's and the next episode starts at
	 * it; mute is never written, so a muted episode can't leave the next one
	 * silent. Setting a level above 0 unmutes, as a slider moved while muted
	 * would otherwise move nothing anyone can hear.
	 */
	function setVolume(v: number) {
		volume = cleanVolume(v);
		if (video) video.volume = volume;
		save(VOLUME_KEY, volume);
		if (muted && volume > 0) setMuted(false);
	}
	/** The VOL cell's slider (c385): a pointer's, so it has no key handler; ↑ ↓ are the keys. */
	let volOpen = $state(false);
	function volAt(e: PointerEvent) {
		const el = e.currentTarget as HTMLElement;
		const box = el.getBoundingClientRect();
		setVolume(verticalFraction(e.clientY, { top: box.top, height: box.height }));
	}
	function volDown(e: PointerEvent) {
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		volAt(e);
	}
	function volMove(e: PointerEvent) {
		if (e.buttons & 1) volAt(e);
	}
	/** The wheel over the cell or its slider steps 5 %; not passive, so the page doesn't scroll. */
	function volWheel(node: HTMLElement) {
		const onWheel = (e: WheelEvent) => {
			if (!e.deltaY) return;
			e.preventDefault();
			setVolume(volume + (e.deltaY < 0 ? WHEEL_STEP : -WHEEL_STEP));
			showChrome();
		};
		node.addEventListener('wheel', onWheel, { passive: false });
		return () => node.removeEventListener('wheel', onWheel);
	}
	function setMuted(m: boolean) {
		muted = m;
		if (video) video.muted = m;
	}
	function setSpeed(s: number) {
		speed = s;
		if (video) video.playbackRate = s;
	}
	function setAudio(lang: string) {
		chosenHere = true;
		audioLang = lang;
		choose('audio', lang);
		pickAudio();
	}
	function setSub(lang: string | null) {
		chosenHere = true;
		subLang = lang;
		choose('subs', lang);
		void loadSubtitles();
	}
	/**
	 * The AUDIO and SUBTITLES rows (c386; doc/ANIME.md, "The settings sheet"):
	 * a wrapping grid of codes, and past LANG_ROW_MAX languages only those that
	 * matter, the rest one per line behind MORE · N. [moreOf] is the row whose
	 * list is open.
	 */
	let moreOf = $state<'audio' | 'subs' | null>(null);
	let device = $state<string | undefined>(undefined);
	const fullName = (t: Track) => t.name ?? langName(t.lang);
	const audioOn = (lang: string | null) =>
		!!quality && (audioLang ?? quality.audio[0]?.lang) === lang;
	const subOn = (lang: string | null) => subLang === lang;
	const audioRow = $derived.by(() => {
		const all = quality?.audio ?? [];
		const r = langRow(
			all.map((t) => t.lang),
			[
				audioLang ?? all[0]?.lang,
				// The original, which the audio starts on.
				all[0]?.lang,
				data.player.series.audio,
				data.player.defaults.audio,
				device,
				'EN'
			]
		);
		return { shown: all.filter((t) => r.shown.includes(t.lang)), more: r.more };
	});
	const subRow = $derived.by(() => {
		const all = quality?.subtitles ?? [];
		const r = langRow(
			all.map((t) => t.lang),
			[subLang, data.player.series.subs, data.player.defaults.subs, device, 'EN']
		);
		return { shown: all.filter((t) => r.shown.includes(t.lang)), more: r.more };
	});
	const langCell = (which: 'audio' | 'subs', lang: string) =>
		root?.querySelector<HTMLElement>(`.langs[data-which="${which}"] [data-lang="${lang}"]`);
	async function openMore(which: 'audio' | 'subs') {
		moreOf = moreOf === which ? null : which;
		if (!moreOf) return;
		await tick();
		// Into the list, on what is playing, so a remote's ↓ goes on from there.
		const list = root?.querySelector<HTMLElement>('.langlist');
		(
			list?.querySelector<HTMLElement>('.on') ?? list?.querySelector<HTMLElement>('button')
		)?.focus();
	}
	async function closeMore() {
		const which = moreOf;
		moreOf = null;
		await tick();
		root?.querySelector<HTMLElement>(`.langs[data-which="${which}"] .more`)?.focus();
	}
	async function pickMore(which: 'audio' | 'subs', lang: string) {
		if (which === 'audio') setAudio(lang);
		else setSub(lang);
		moreOf = null;
		await tick();
		// The pick is a cell of the row now (what is on always is): focus goes there.
		langCell(which, lang)?.focus();
	}
	function setSubSize(z: SubSize) {
		subSize = z;
		choose('subsize', z);
	}
	function setDim(v: number) {
		dim = v;
		save('tsundoku:anime:dim', v);
	}

	let root = $state<HTMLElement | null>(null);
	/** The bar's own start: ▶❚❚ (TV-Focus, "PLAYER"). */
	const barStart = () => root?.querySelector<HTMLElement>('.cells [data-focus-start]') ?? null;
	async function full() {
		try {
			if (document.fullscreenElement) await document.exitFullscreen();
			else {
				await root?.requestFullscreen();
				// FULL turns a portrait phone (Anime Calls, "Devices"): where the browser lets it.
				await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })
					.lock?.('landscape')
					.catch(() => undefined);
			}
		} catch {
			// Not every browser allows it.
		}
	}

	onMount(() => {
		subSize = startTracks({ audio: [], subs: [], ...data.player }).subsize;
		dim = load<number>('tsundoku:anime:dim', 0);
		// Read once, before the stream starts, so the first frame is already at it.
		volume = cleanVolume(load<unknown>(VOLUME_KEY, 1));
		if (video) video.volume = volume;
		device = navigator.language;
		mouse = matchMedia('(pointer: fine)').matches;
		pipable = canPip();
		void start();
		const close = () => opened && void send('close');
		addEventListener('pagehide', close);
		return () => {
			removeEventListener('pagehide', close);
			// NEXT and leaving the page destroy the player: the picture comes back
			// first, and the floating window goes with it rather than staying
			// empty (c388). Here and not in onDestroy, which runs on the server too.
			closePip();
			if (document.pictureInPictureElement === video)
				void document.exitPictureInPicture().catch(() => undefined);
		};
	});
	onDestroy(() => {
		if (opened) void send('close');
		detach();
		preview?.destroy();
		for (const t of [waitTimer, checkTimer, stallTimer, countTimer]) clearInterval(t);
		for (const t of [hideTimer, flashTimer, previewTimer]) clearTimeout(t);
	});

	// The tracks to start with, once the source says which it has (startTracks:
	// the series', SETTINGS', the last on any anime, then the original audio and
	// the device's language). Worked out, not chosen, so nothing is saved; worked
	// out again for each server the player moves to (the first may have none),
	// until a choice is made in the sheet.
	let chosenHere = false;
	$effect(() => {
		if (!quality || chosenHere) return;
		const audio = quality.audio.map((a) => a.lang);
		const subs = quality.subtitles.map((t) => t.lang);
		// A choice kept before c386 named PT for what is PT-BR now, or HUN
		// for HU: each is read as the offered track it meant (matchLang).
		const fit = (c: TrackChoice): TrackChoice => ({
			...c,
			audio: c.audio === undefined ? undefined : (matchLang(c.audio, audio) ?? c.audio),
			subs: c.subs == null ? c.subs : (matchLang(c.subs, subs) ?? c.subs)
		});
		const start = startTracks({
			audio,
			subs,
			series: fit(data.player.series),
			defaults: fit(data.player.defaults),
			last: fit(data.player.last),
			device: matchLang(navigator.language, subs) ?? deviceLang(navigator.language)
		});
		subLang = start.subs;
		void loadSubtitles();
		audioLang = start.audio;
		pickAudio();
	});
	$effect(() => {
		void paused;
		void sheet;
		if (!paused && !sheet) showChrome();
		else {
			chrome = true;
			clearTimeout(hideTimer);
		}
	});

	const pct = (v: number) => (duration > 0 ? `${Math.min(100, (v / duration) * 100)}%` : '0%');
	const scale = $derived(challengeScale(waited));
	const waitLabel = $derived(
		checkingSince !== null ? 'THE SOURCE IS CHECKING THE WORKSTATION' : 'FINDING THE VIDEO'
	);
</script>

<svelte:window onkeydown={keydown} />

<!-- A language row of the sheet (c386): equal cells of codes, as many to a line
     as fit, the name in full as each one's title; MORE · N opens the rest as a
     list, one language a line, in the same sheet. -->
{#snippet langGrid(
	which: 'audio' | 'subs',
	all: Track[],
	row: { shown: Track[]; more: number },
	on: (lang: string | null) => boolean,
	pick: (lang: string | null) => void
)}
	<div
		class="langs"
		data-which={which}
		role="group"
		aria-label={which === 'audio' ? 'Audio' : 'Subtitles'}
	>
		{#if which === 'subs'}
			<button type="button" class:on={on(null)} aria-pressed={on(null)} onclick={() => pick(null)}
				>OFF</button
			>
		{/if}
		{#each row.shown as t (t.src)}
			<button
				type="button"
				data-lang={t.lang}
				class:on={on(t.lang)}
				aria-pressed={on(t.lang)}
				title={fullName(t)}
				aria-label={fullName(t)}
				onclick={() => pick(t.lang)}>{t.lang}</button
			>
		{/each}
		{#if row.more}
			<button
				type="button"
				class="more"
				aria-expanded={moreOf === which}
				onclick={() => openMore(which)}>MORE · {row.more}</button
			>
		{/if}
	</div>
	{#if moreOf === which}
		<div
			class="langlist"
			role="group"
			aria-label={which === 'audio' ? 'Every audio language' : 'Every subtitle language'}
		>
			{#each all as t (t.src)}
				<button
					type="button"
					class="li"
					class:on={on(t.lang)}
					aria-pressed={on(t.lang)}
					onclick={() => pickMore(which, t.lang)}
				>
					<span>{fullName(t).toUpperCase()}</span>
					<span class="r">{on(t.lang) ? `● ${t.lang}` : t.lang}</span>
				</button>
			{/each}
		</div>
	{/if}
{/snippet}

<!-- The scrubber's tip (c387, c385): the time under the pointer, and above it
     the frame there when there is one, kept inside the track. -->
{#snippet tip(at: number)}
	{@const tile = sprite ? spriteTile(sprite, at) : null}
	{@const still = streamPic && nearFrame(streamPic.at, at, duration) ? streamPic.src : null}
	{@const pic = !!tile || !!still}
	<div
		class="tip"
		class:pic
		style:left="clamp({pic ? 'var(--tip-half)' : '0px'}, {pct(at)}, calc(100% - {pic
			? 'var(--tip-half)'
			: '0px'}))"
	>
		{#if sprite && tile}
			<div
				class="frame"
				style:width="{sprite.w}px"
				style:height="{sprite.h}px"
				style:background-image="url({sprite.src})"
				style:background-position="{-tile.x}px {-tile.y}px"
			></div>
		{:else if still}
			<div class="frame" style:background-image="url({still})"></div>
		{/if}<span class="at">{clock(at)}</span>
	</div>
{/snippet}

{#snippet workCard()}
	{#if workNext && work}
		<!-- The Work's next part, where the end card is (Work-EndStates 3): no
				     countdown, and nothing plays another series by itself. -->
		<section class="upn" aria-label="Next in the Work">
			<div class="k">
				<span>NEXT IN THE WORK · {kindVerb(workNext.kind)}</span>
				<span>PART {work.part + 1} OF {work.of}</span>
			</div>
			<div class="bd">
				<span class="cv"
					><Cover src={coverSrc(workNext.seriesId, workNext.cover)} hue={workNext.hue} /></span
				>
				<div class="t">
					<div class="a">{workNext.title}</div>
					<div class="b">{workMeta}</div>
					<div class="b">WORK · {work.name.toUpperCase()}</div>
				</div>
			</div>
			<div class="acts">
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- readHref()/resolve() built both -->
				<a class="acc" href={workStart} data-player-work data-focus-mark="in" data-focus-start
					>▶ {kindVerb(workNext.kind)} · {unitLabel(workNext.kind)}. {workNext.entry?.number ??
						1}<span>→</span></a
				>
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolved above -->
				<a href={workHref} data-focus-mark="in">WORK</a>
				<button type="button" aria-label="Close" onclick={() => (workClosed = true)}>✕</button>
			</div>
		</section>
	{/if}
{/snippet}

<div
	class="player"
	class:hidden-series={data.series.hidden}
	class:chrome
	bind:this={root}
	role="presentation"
	data-focus-off={!tv.current || (phase === 'playing' && !chrome && !overlay) ? '' : undefined}
	onfocusin={onFocusIn}
	onpointermove={pointerMoved}
>
	<div class="stage" bind:this={stage}>
		<!-- Subtitles are drawn by tsundoku from the WebVTT (Anime Calls, "Subtitles"), in the
		     page and in a Document Picture-in-Picture window alike. The <track> is the same
		     WebVTT for the browser's own picture-in-picture only, which moves the <video>
		     alone: always showing, its cues drawn invisibly on the page except while the
		     browser says that is open (c388, pip.ts). -->
		<video
			bind:this={video}
			bind:paused
			playsinline
			class:cueless={!inNativePip}
			{@attach nativePipEvents}
			ontimeupdate={onTime}
			ondurationchange={onDuration}
			onwaiting={onWaiting}
			onpause={() => watch.stop()}
			onplaying={onProgressing}
			onprogress={() =>
				(buffered = video ? bufferedTo(rangesOf(video.buffered), video.currentTime) : 0)}
			onended={onEnded}
			onerror={() => phase === 'playing' && !hls && void fail()}
		>
			{#if pipTrack}
				{#key pipTrack.src}
					<track
						bind:this={trackEl}
						kind="subtitles"
						src={pipTrack.src}
						srclang={srclang(pipTrack.lang)}
						label={langName(pipTrack.lang)}
					/>
				{/key}
			{/if}
		</video>
		<!-- A surface that draws nothing: hovering or clicking the picture never tints it (c485). -->
		<button
			type="button"
			class="tapzone"
			data-focus-skip
			data-press="off"
			aria-label={mouse
				? paused
					? 'Play'
					: 'Pause'
				: chrome
					? 'Hide the controls'
					: 'Show the controls'}
			onpointerdown={(e) => (pressed = { x: e.clientX, y: e.clientY })}
			onpointerup={pictureTap}
		></button>
		{#if dim > 0}<div class="dim" style:opacity={dim} aria-hidden="true"></div>{/if}

		{#if line}
			<div class="subs" aria-live="off">
				<div class="line" style:--sub-size="{subtitlePx(subSize, 30)}px">{line}</div>
			</div>
		{/if}
	</div>

	{#if inDocPip}
		<!-- The picture is in its own window: the page says so where it was (c388). -->
		<div class="pipnote" role="status">
			<div>IN PICTURE-IN-PICTURE</div>
			<div class="mut">PIP · ON BRINGS IT BACK</div>
		</div>
	{/if}

	{#if phase === 'playing'}
		{#if resumedAt !== null}
			<div class="resume" role="status">
				<div>RESUMED AT {clock(resumedAt)}</div>
				<button type="button" onclick={fromStart}>FROM 0:00</button>
			</div>
		{/if}
		{#if skipShown}
			<button type="button" class="skip" data-player-skip data-focus-start onclick={skipNow}
				>{skip}</button
			>
		{/if}
		{#if seekFlash}
			<div class="flash" class:back={seekFlash.by < 0} role="status">
				<div class="by">{seekFlash.by > 0 ? '+' : '−'}{Math.abs(seekFlash.by)} S</div>
				<div class="to">{clock(seekFlash.to)}</div>
			</div>
		{/if}
		{#if stalled !== null && stallSeconds >= 2}
			{@const step = stallNext()}
			{@const to = step && 'server' in step ? step.server : null}
			{@const down = step && 'quality' in step ? server?.qualities[step.quality] : undefined}
			<div class="panel buffer" role="status">
				<div class="body">
					<div class="head">
						<div>BUFFERING</div>
						<div>{stallSeconds} S</div>
					</div>
					<div class="ink"></div>
					<div class="m">
						WAITING ON THE SERVER · SERVER {serverN} OF {order.length} · {Math.max(
							0,
							Math.round(buffered - time)
						)} S AHEAD OF {clock(time)}{to !== null
							? ` · MOVES TO SERVER ${to} BY ITSELF AT ${STALL_S} S`
							: down
								? ` · DROPS TO ${qualityName(down)} BY ITSELF AT ${STALL_S} S`
								: ''}
					</div>
				</div>
				{#if to !== null}
					<button type="button" onclick={() => switchServer(to)}>SERVER {to} NOW →</button>
				{:else if down && step && 'quality' in step}
					{@const i = step.quality}
					<button type="button" onclick={() => stepDown(i)}>{qualityName(down)} NOW →</button>
				{/if}
			</div>
		{/if}
		{#if qualityNotice}
			<div class="panel servers" role="status">
				<div class="head">
					<div>{qualityNotice.from} COULDN'T KEEP UP</div>
					<div class="mut">AT {clock(qualityNotice.at)}</div>
				</div>
				<div class="foot">
					<div class="m">
						PICKS UP AT {clock(qualityNotice.at)} ON {qualityNotice.to} · THIS EPISODE ONLY
					</div>
				</div>
			</div>
		{:else if serverNotice}
			<div class="panel servers" role="status">
				<div class="head">
					<div>SERVER {serverNotice.from} STOPPED SENDING</div>
					<div class="mut">AT {clock(serverNotice.at)}</div>
				</div>
				{#each streams?.servers ?? [] as s (s.n)}
					<div class="srow" class:on={s.n === serverN} class:off={failed.has(s.n)}>
						<div class="mk">{failed.has(s.n) ? '✕' : s.n === serverN ? '…' : ''}</div>
						<div class="t">SERVER {s.n} · {qualitiesLine(s.qualities)}</div>
						<div class="r">
							{failed.has(s.n)
								? `STOPPED AT ${clock(failedAt[s.n] ?? 0)}`
								: s.n === serverN
									? 'ASKING'
									: ''}
						</div>
					</div>
				{/each}
				<div class="foot">
					<div class="m">PICKS UP AT {clock(serverNotice.at)} ON THE NEXT ONE TO ANSWER</div>
					<button type="button" onclick={() => ((sheet = true), (serverNotice = null))}
						>CHOOSE</button
					>
				</div>
			</div>
		{/if}

		{#if !offline.online}
			<div class="offband">
				<div>○ OFFLINE</div>
				<div class="mut">CACHED STILL PLAYS</div>
			</div>
		{/if}

		<!-- The middle cluster: −10, pause, +10, under the thumb. It steps aside while a
		     waiting box holds the middle (Player Waiting 3a draws the box alone): the
		     two overlapped (reported 2026-10-29). -->
		<div
			class="cluster"
			class:aside={(stalled !== null && stallSeconds >= 2) || !!serverNotice || !!qualityNotice}
		>
			<button type="button" aria-label="Back 10 seconds" onclick={() => (seek(-10), showChrome())}
				>−10</button
			>
			<button type="button" class="pp" aria-label={paused ? 'Play' : 'Pause'} onclick={toggle}>
				{#if paused}▶{:else}<i></i><i></i>{/if}
			</button>
			<button type="button" aria-label="On 10 seconds" onclick={() => (seek(10), showChrome())}
				>+10</button
			>
		</div>

		<header class="top" data-focus-skip={!tv.current || chrome ? undefined : ''}>
			<a class="back" href={seriesHref} aria-label="Back to the series" use:backLink>←</a>
			<div class="names">
				<div class="t">
					{data.series.title}{#if ep.title}<span>{` · ${ep.title}`}</span>{/if}
				</div>
				<div class="m">
					<span class="long"
						>ANIME · {place} · {clock(time)} OF {clock(duration)}{data.record && !added
							? ' · NOT IN LIBRARY'
							: ''}</span
					>
					<span class="short">{place}</span>
				</div>
			</div>
			{@render addCell('cell add')}
			<button type="button" class="cell desk" onclick={full}>FULL SCREEN · F</button>
		</header>

		<footer class="bottom" data-focus-skip={!tv.current || chrome ? undefined : ''}>
			<div class="scrubrow">
				<div class="e">{clock(time)}</div>
				<!-- The pad's OK is turned into a click on the focused thing by the focus
				     layer's own Enter handler, which is why there is no key handler here
				     (and why one would press twice). -->
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<div
					class="track"
					bind:this={scrub}
					role="slider"
					tabindex="0"
					data-focus-adjust
					data-focus-up={focusUp}
					aria-label="Position"
					aria-valuemin={0}
					aria-valuemax={Math.round(duration)}
					aria-valuenow={Math.round(time)}
					aria-valuetext={clock(time)}
					onpointerdown={scrubDown}
					onpointermove={scrubMove}
					onpointerleave={leaveScrub}
					onclick={(e) => {
						// OK on the pad clicks the focused thing (the layer's OK press), and
						// the bar is an arrow stop since c296. A pointer's click on the bar is
						// a seek, so only a detail-less click -- one an element made -- is the
						// pad's, and it toggles the picture, the nearest verb the bar's own
						// row acts out (c296, the review's round-1 low 5).
						if (e.detail === 0) toggle();
					}}
				>
					<div class="buf" style:width={pct(buffered)}></div>
					<div class="seen" style:width={pct(time)}></div>
					{#each marks as m, i (i)}<div class="tick" style:left="{m * 100}%"></div>{/each}
					<div class="thumb" style:left={pct(time)}></div>
					{#if hoverAt !== null}
						<div class="hover" style:left={pct(hoverAt)}></div>
						{@render tip(hoverAt)}
					{/if}
				</div>
				<div class="l">{leftLabel(time, duration)}</div>
			</div>
			<div class="cells">
				<button
					type="button"
					class="cell desk pause"
					aria-label={paused ? 'Play' : 'Pause'}
					data-focus-start
					onclick={toggle}
					>{#if paused}▶{:else}<i></i><i></i>{/if}</button
				>
				<!-- A TV's bar, its six cells on one row (TV-Board-Player 6B). They are
				     hidden elsewhere: there, the cluster in the middle is the thumb's. -->
				<button
					type="button"
					class="cell tv"
					aria-label="Back 10 seconds"
					onclick={() => (seek(-10), showChrome())}>−10</button
				>
				<button
					type="button"
					class="cell tv"
					aria-label="On 10 seconds"
					onclick={() => (seek(10), showChrome())}>+10</button
				>
				<button type="button" class="cell" disabled={!prev} onclick={playPrev}
					>{prev ? `← ${epShort(prev)}` : '←'}</button
				>
				<!-- VOL (c385): the label mutes, as before; hovering or clicking it opens
				     the slider above it, and the wheel over either steps 5 %. -->
				<div
					class="vol desk"
					class:open={volOpen}
					role="group"
					aria-label="Volume"
					onpointerleave={() => (volOpen = false)}
					{@attach volWheel}
				>
					<button
						type="button"
						class="cell"
						aria-label={muted ? 'Unmute' : 'Mute'}
						onclick={() => {
							setMuted(!muted);
							volOpen = true;
						}}>{muted ? 'MUTED' : `VOL ${Math.round(volume * 100)}%`}</button
					>
					<div class="volpop">
						<div
							class="vtrack"
							role="slider"
							tabindex="-1"
							aria-label="Volume"
							aria-orientation="vertical"
							aria-valuemin={0}
							aria-valuemax={100}
							aria-valuenow={Math.round(volume * 100)}
							aria-valuetext={muted ? 'Muted' : `${Math.round(volume * 100)}%`}
							onpointerdown={volDown}
							onpointermove={volMove}
						>
							<div class="vfill" style:height="{(muted ? 0 : volume) * 100}%"></div>
							<div class="vthumb" style:bottom="{(muted ? 0 : volume) * 100}%"></div>
						</div>
					</div>
				</div>
				<button type="button" class="cell grow" onclick={() => (sheet = true)}>{playing}</button>
				{#if pipable}
					<button
						type="button"
						class="cell desk"
						aria-label={inDocPip ? 'Bring the picture back' : 'Picture in picture'}
						aria-pressed={inDocPip}
						onclick={() => void pip()}>{inDocPip ? 'PIP · ON' : 'PIP'}</button
					>
				{/if}
				<button type="button" class="cell desk" onclick={() => (keysOpen = true)}>? KEYS</button>
				<button type="button" class="cell" disabled={!next || !playable(next)} onclick={playNext}
					>{next
						? playable(next)
							? `${epShort(next)} →`
							: `${epShort(next)} · NOT CACHED`
						: '→'}</button
				>
			</div>
		</footer>

		{#if endcardShown}
			<div class="endcard" role="status">
				<div class="row">
					<div
						class="pic"
						style:background-image={next.thumb ? `url(${next.thumb})` : undefined}
					></div>
					<div class="txt">
						<div class="k">NEXT · {placeLabel(next, ofSeason, false)}</div>
						<div class="t">{next.title || `Episode ${next.number}`}</div>
						<div class="m">
							{[metaOf(next), next.available ? 'DOWNLOADED' : ''].filter(Boolean).join(' · ')}
						</div>
					</div>
				</div>
				<div class="when">PLAYS WHEN THIS ONE ENDS · IN {clock(Math.max(0, duration - time))}</div>
				<div class="two">
					<button type="button" onclick={stayHere}>STAY</button>
					<button type="button" class="acc" data-player-play data-focus-start onclick={playNext}
						>PLAY NOW →</button
					>
				</div>
			</div>
		{/if}

		{#if workCardShown}
			{@render workCard()}
		{/if}

		{#snippet addCell(cls: string)}
			{#if data.record?.preview}
				<!-- A browsing record has no rating or FAV to trade; + ADD takes the cell
				     (Online Calls, "The reader, for a record"), and adds without leaving. -->
				<form
					method="POST"
					action="{resolve('/downloads/source/[id]', { id: data.record.preview })}?/add"
					use:enhance={() => {
						adding = true;
						return async ({ result }) => {
							adding = false;
							if (result.type === 'redirect') added = true;
						};
					}}
				>
					<button type="submit" class={cls} disabled={adding || added}
						>{added ? 'IN LIBRARY ✓' : adding ? 'ADDING…' : '+ ADD'}</button
					>
				</form>
			{/if}
		{/snippet}

		<!-- Portrait (Anime Calls, "Devices"): the controls always shown beneath, what's next below. -->
		<section class="portrait" aria-label="Controls">
			<div class="pbar">
				<a class="back" href={seriesHref} aria-label="Back to the series" use:backLink>←</a>
				<div class="m">{place}</div>
				{@render addCell('padd')}
				<button type="button" onclick={full}>FULL</button>
			</div>
			<!-- The scrubber under the picture (c387): the bar's own handlers and
			     slider role, measured on this track. It sits outside the scrolling
			     body, so a drag's tip can rise over the picture rather than be
			     clipped, and what is next scrolls under it. -->
			<div class="pscrub">
				<div>{clock(time)}</div>
				<div
					class="track"
					role="slider"
					tabindex="0"
					aria-label="Position"
					aria-valuemin={0}
					aria-valuemax={Math.round(duration)}
					aria-valuenow={Math.round(time)}
					aria-valuetext={clock(time)}
					onpointerdown={scrubDown}
					onpointermove={scrubMove}
					onpointerleave={leaveScrub}
				>
					<div class="buf" style:width={pct(buffered)}></div>
					<div class="seen" style:width={pct(time)}></div>
					<div class="thumb" style:left={pct(time)}></div>
					{#if hoverAt !== null}
						{@render tip(hoverAt)}
					{/if}
				</div>
				<div class="mut">{leftLabel(time, duration)}</div>
			</div>
			<div class="pbody">
				<div class="pcells">
					<button type="button" aria-label="Back 10 seconds" onclick={() => seek(-10)}>−10</button>
					<button type="button" aria-label={paused ? 'Play' : 'Pause'} onclick={toggle}
						>{#if paused}▶{:else}<i></i><i></i>{/if}</button
					>
					<button type="button" aria-label="On 10 seconds" onclick={() => seek(10)}>+10</button>
					<button type="button" class="small" onclick={() => (sheet = true)}
						>{[subLang, quality ? qualityName(quality) : null].filter(Boolean).join(' · ')}</button
					>
				</div>
				<div class="pnames">
					<div class="k">ANIME · {place}</div>
					<div class="t">{data.series.title}</div>
					{#if ep.title}<div class="s">{ep.title}</div>{/if}
				</div>
				<div class="plabel">
					<div>02 — UP NEXT</div>
					<div>{leftInSeason} LEFT</div>
				</div>
				{#each upNext as u (u.id)}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- readHref() resolves -->
					<a class="up" href={readHref(u.id)}>
						<div class="n">{u.number}</div>
						<div class="pic" style:background-image={u.thumb ? `url(${u.thumb})` : undefined}></div>
						<div class="txt">
							<div class="t">{u.title || `Episode ${u.number}`}</div>
							<div class="m">
								{[metaOf(u), u.available ? 'DOWNLOADED' : ''].filter(Boolean).join(' · ')}
							</div>
						</div>
					</a>
				{/each}
			</div>
		</section>
	{/if}

	{#if sheet && streams}
		<button
			type="button"
			class="scrim appear"
			out:leave
			aria-label="Close the settings"
			onclick={() => (sheet = false)}
		></button>
		<div
			class="sheet rise rise-right"
			out:leave={'right'}
			role="dialog"
			aria-label="Playback settings"
			use:focusScope
		>
			<div class="shead">
				<div>PLAYBACK · {epShort(ep)}</div>
				<button type="button" aria-label="Close" onclick={() => (sheet = false)}>✕</button>
			</div>
			<div class="srows">
				<div class="srow2">
					<div class="lab">QUALITY</div>
					<div class="val">
						<div class="seg">
							{#each server?.qualities ?? [] as q, i (q.src)}
								<button
									type="button"
									class:on={i === qualityIndex}
									data-focus-start={i === 0 ? '' : undefined}
									onclick={() => setQuality(i)}>{qualityName(q)}</button
								>
							{/each}
						</div>
						<div class="note">
							THIS SERVER'S {server?.qualities.length} · THIS DEVICE REMEMBERS ITS OWN
						</div>
					</div>
				</div>
				<div class="srow2">
					<div class="lab">SERVER</div>
					<div class="val">
						{#each streams.servers as s (s.n)}
							<button
								type="button"
								class="li"
								class:on={s.n === serverN}
								class:off={failed.has(s.n)}
								onclick={() => switchServer(s.n)}
							>
								<span>{(s.name || `SERVER ${s.n}`).toUpperCase()}</span>
								<span class="r"
									>{s.n === serverN
										? `● PLAYING · ${qualitiesLine(s.qualities)}`
										: failed.has(s.n)
											? `STOPPED ${clock(failedAt[s.n] ?? 0)}`
											: qualitiesLine(s.qualities)}</span
								>
							</button>
						{/each}
						<div class="note">STALLS FOR {STALL_S} S → THE NEXT, BY ITSELF</div>
					</div>
				</div>
				{#if quality && quality.audio.length > 1}
					<div class="srow2">
						<div class="lab">AUDIO</div>
						<div class="val">
							{@render langGrid('audio', quality.audio, audioRow, audioOn, (l) => l && setAudio(l))}
						</div>
					</div>
				{/if}
				<div class="srow2">
					<div class="lab">SUBTITLES</div>
					<div class="val">
						{#if quality && quality.subtitles.length}
							{@render langGrid('subs', quality.subtitles, subRow, subOn, setSub)}
							<div class="seg">
								{#each SUB_SIZES as z (z)}
									<button type="button" class:on={subSize === z} onclick={() => setSubSize(z)}
										>{z}</button
									>
								{/each}
							</div>
						{:else}
							<div class="note">IN THE PICTURE · NOTHING TO SWITCH</div>
						{/if}
					</div>
				</div>
				<div class="srow2">
					<div class="lab">SPEED</div>
					<div class="val">
						<div class="seg">
							{#each SPEEDS as s (s)}
								<button type="button" class:on={speed === s} onclick={() => setSpeed(s)}
									>{s === 1 ? '1×' : s}</button
								>
							{/each}
						</div>
					</div>
				</div>
				<div class="srow2">
					<div class="lab">DIM</div>
					<div class="val">
						<div class="dimrow">
							<input
								type="range"
								min="0"
								max="0.8"
								step="0.05"
								value={dim}
								aria-label="Dim"
								oninput={(e) => setDim(Number((e.currentTarget as HTMLInputElement).value))}
							/>
							<div>{Math.round(dim * 100)}%</div>
						</div>
					</div>
				</div>
			</div>
			<div class="sfoot">
				AUDIO AND SUBTITLES CARRY TO EVERY EPISODE OF THE SERIES · SPEED TO THIS ONE · QUALITY TO
				THIS DEVICE
			</div>
			<!-- ALL SETTINGS →: the page, at WATCHING (Reach, readerSheet; card c171). -->
			<a class="all-settings" href="{resolve('/settings')}?section=watching"
				><span>ALL SETTINGS →</span><span class="n">DEFAULTS, AND WHAT EACH ROW KEEPS</span></a
			>
		</div>
	{/if}

	{#if keysOpen}
		<button
			type="button"
			class="scrim keys-scrim appear"
			out:leave
			aria-label="Close the keys"
			onclick={() => (keysOpen = false)}
		></button>
		<div class="sheet keys rise rise-right" out:leave={'right'} role="dialog" aria-label="Keys">
			<div class="shead">
				<div>KEYS</div>
				<button type="button" aria-label="Close" onclick={() => (keysOpen = false)}>✕</button>
			</div>
			{#each [['SPACE', 'Play or pause'], ['← →', 'Back or on 10 s'], ['↑ ↓', 'Volume'], ['F', 'Full screen'], ['M', 'Mute'], ['C', 'Subtitles on or off'], ['S', 'Skip the intro or ending, when offered'], ['N', 'Next episode'], ['ESC', 'Leave full screen, then the player'], ['?', 'These keys']] as [k, a] (k)}
				<div class="krow">
					<div class="k">{k}</div>
					<div class="a">{a}</div>
				</div>
			{/each}
		</div>
	{/if}

	{#if phase !== 'playing'}
		<!-- Waits and ends are the reader's end-of-chapter page (Player Waiting, "Interstitials"). -->
		<div class="inter" role="status">
			<div class="imid">
				<div class="kick">
					<div>{phase === 'ended' ? `END · ${epShort(ep)}` : place}</div>
					<div>
						{phase === 'ended'
							? `${ep.number} OF ${ofSeason}${ep.season !== null ? ` · SEASON ${ep.season}` : ''}`
							: phase === 'challenge'
								? `${(data.source?.name ?? '').toUpperCase()} · FIRST CALL`
								: (data.source?.name ?? '').toUpperCase()}
					</div>
				</div>
				<div class="rule" class:ink={phase === 'resolving' || phase === 'challenge'}></div>
				<div class="what">
					<div class="label">
						{phase === 'offline'
							? 'NOT ON THIS DEVICE'
							: phase === 'resolving' || phase === 'challenge'
								? waitLabel
								: phase === 'noServer'
									? 'NO SERVER ANSWERED'
									: phase === 'engine'
										? 'SOURCES NOT ANSWERING'
										: next
											? 'NEXT'
											: 'END · LAST AVAILABLE'}
					</div>
					<div
						class="big"
						class:faint={phase === 'noServer' ||
							phase === 'engine' ||
							phase === 'offline' ||
							(phase === 'ended' && !!next && !playable(next))}
					>
						{phase === 'ended' && next
							? next.title || `Episode ${next.number}`
							: ep.title || `Episode ${ep.number}`}
					</div>
					<div
						class="tag"
						class:ink={phase === 'offline' || (phase === 'ended' && !!next && !playable(next))}
					>
						{phase === 'offline' || (phase === 'ended' && next && !playable(next))
							? '○ NOT CACHED'
							: phase === 'resolving'
								? `${waited} S · USUALLY A FEW SECONDS`
								: phase === 'challenge'
									? 'THE FIRST CALL OF THE DAY TAKES 20–45 S · THEN SECONDS'
									: phase === 'noServer'
										? `${order.length || 'NO'} TRIED`
										: phase === 'engine'
											? 'THE WORKSTATION ANSWERED · THE PART THAT TALKS TO SOURCES DID NOT'
											: next
												? [epShort(next), metaOf(next), next.available ? 'DOWNLOADED' : '']
														.filter(Boolean)
														.join(' · ')
												: ''}
					</div>
				</div>
				{#if phase === 'challenge'}
					<div class="scale" aria-hidden="true">
						<div class="base"></div>
						<div
							class="range"
							style:left="{scale.from * 100}%"
							style:width="{(scale.to - scale.from) * 100}%"
						></div>
						<div class="done" style:width="{scale.at * 100}%"></div>
						<div class="mark" style:left="{scale.at * 100}%"></div>
						<div class="now" style:left="{scale.at * 100}%">{waited} S</div>
						<div class="n0">0</div>
						<div class="n20" style:left="{scale.from * 100}%">20</div>
						<div class="n45" style:left="{scale.to * 100}%">45</div>
						<div class="n60">60 S</div>
					</div>
					<div class="prose">
						{data.source?.name} checks a new visitor before it answers. Once it has, its episodes start
						in seconds until the workstation restarts.
					</div>
				{/if}
				{#if phase === 'offline' || (phase === 'ended' && next && !playable(next))}
					<div class="prose">
						{phase === 'offline'
							? 'It plays once the workstation is reachable. Downloaded episodes the device keeps play offline.'
							: `Episode ${next?.number} plays once the workstation is reachable.`}
					</div>
				{/if}
				{#if phase === 'ended' && next && !stay && playable(next)}
					<div class="count">
						<div class="c">PLAYS IN {count}</div>
						<div class="bar">
							<div style:width="{((NEXT_COUNT_S - count) / NEXT_COUNT_S) * 100}%"></div>
						</div>
					</div>
				{/if}
				{#if phase === 'ended' && !next && workNext && !workClosed}
					<!-- The last episode of a Work ends on its next part, not only LIBRARY (W6). -->
					<div class="work-end">{@render workCard()}</div>
				{/if}
				{#if phase === 'noServer'}
					<div class="prose">
						The source listed {order.length || 'no'} server{order.length === 1 ? '' : 's'} for this episode
						and none of them sent video. TRY AGAIN asks the source for its list afresh. Servers often
						come back within the hour.
					</div>
					{#if failureLine}
						<!-- Not just this episode (doc/MOVE.md; Migrate Calls, PLAYER). -->
						<div class="also">
							<div class="a">NOT JUST THIS EPISODE</div>
							<div class="b">{failureLine} · ANOTHER SOURCE MAY HAVE IT</div>
						</div>
					{/if}
				{:else if phase === 'engine'}
					<div class="prose">
						Downloaded episodes still play. Streaming and downloading wait until it answers. TRY
						AGAIN asks again.
					</div>
				{/if}
			</div>
			<div class="icells">
				<a class="icell br" href={seriesHref} use:backLink>← SERIES</a>
				<div class="icell flex"></div>
				{#if phase === 'noServer'}
					<!-- The way out when a source sends no video (doc/MOVE.md). -->
					<a class="icell bl" href={moveHref}>ANOTHER SOURCE →</a>
					<button
						type="button"
						class="icell acc"
						onclick={() => ((freshTried = false), start(true))}>TRY AGAIN</button
					>
				{:else if phase === 'engine'}
					<button
						type="button"
						class="icell acc"
						onclick={() => ((freshTried = false), start(true))}>TRY AGAIN</button
					>
				{:else if phase === 'ended' && next && playable(next)}
					{#if !stay}<button type="button" class="icell bl" onclick={stayHere}>STAY</button>{/if}
					<button type="button" class="icell acc" onclick={playNext}>PLAY NOW →</button>
				{:else if phase === 'ended' || phase === 'offline'}
					<a class="icell bl" href={libraryHref}>LIBRARY</a>
				{/if}
			</div>
		</div>
	{/if}

	{#if data.series.hidden}<div class="reveal" aria-hidden="true"></div>{/if}
	{#if data.incognito}<div class="dashed" aria-hidden="true"></div>{/if}
</div>

<style>
	.all-settings {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		min-height: 64px;
		padding: 0 var(--pad, 24px);
		border-top: var(--hairline);
		color: var(--text-1);
		text-decoration: none;
		font: 500 14px var(--font-mono);
	}
	.all-settings .n {
		font-weight: 400;
		font-size: 13px;
		color: var(--text-2);
		text-align: right;
	}
	/*
	 * The literals are the handoff's (Index Player, Player States, Player
	 * Waiting): a 64px top bar, a 56px scrubber over 64px cells, a 96px
	 * cluster, a 520px sheet. Tokens for colour; the picture's ground is true
	 * black, as the reader's is.
	 */
	.player {
		position: fixed;
		inset: 0;
		background: #000;
		color: var(--text-1);
		overflow: hidden;
		--top-h: 64px;
		--scrub-h: 56px;
		--cell-h: 64px;
		--pad-x: 24px;
		--cl: 96px;
		--cl-font: 18px;
		--play-font: 24px;
		--bar-w: 7px;
		--bar-h: 26px;
		--sub-base: 30px;
	}
	/* The phone, landscape: Player States 2d. */
	@media (max-height: 499px) {
		.player {
			--top-h: 52px;
			--scrub-h: 44px;
			--cell-h: 52px;
			--pad-x: 16px;
			--cl: 64px;
			--cl-font: 15px;
			--play-font: 18px;
			--bar-w: 5px;
			--bar-h: 18px;
			--sub-base: 20px;
		}
	}
	/* The desktop in a window: 2d. */
	@media (pointer: fine) and (min-height: 500px) {
		.player {
			--top-h: 56px;
			--cell-h: 56px;
			--sub-base: 26px;
		}
	}
	.stage {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	video {
		width: 100%;
		height: 100%;
		object-fit: contain;
		background: #000;
	}
	/* The native track's cues (pip.ts): showing for a PiP window to read,
	   invisible on the page, where tsundoku draws its own line. !important
	   because Chromium writes a user's OS caption style (Accessibility >
	   Captions) as inline style on the cue box, and inline style beats a normal
	   author rule; an author !important beats it (c449). */
	video.cueless::cue {
		color: transparent !important;
		background: transparent !important;
		text-shadow: none !important;
	}
	.tapzone {
		position: absolute;
		inset: 0;
		border: 0;
		padding: 0;
		background: transparent;
		cursor: default;
		touch-action: manipulation;
	}
	.dim {
		position: absolute;
		inset: 0;
		background: #000;
		pointer-events: none;
	}
	.pipnote {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 8px;
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
		color: var(--text-1);
		pointer-events: none;
	}
	.pipnote .mut {
		color: var(--text-2);
	}
	.subs {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 7%;
		display: flex;
		justify-content: center;
		pointer-events: none;
		transition: bottom 0.15s;
	}
	.player.chrome .subs {
		bottom: calc(var(--scrub-h) + var(--cell-h) + 1px + 20px);
	}
	.line {
		max-width: 80%;
		padding: 4px 14px;
		background: rgba(0, 0, 0, 0.6);
		font: 500 var(--sub-size, var(--sub-base)) / 1.35 var(--font-sans);
		color: #fff;
		text-align: center;
		text-wrap: balance;
		white-space: pre-line;
	}
	.resume {
		position: absolute;
		left: 32px;
		bottom: 32px;
		display: flex;
		align-items: stretch;
		height: 56px;
		background: var(--surface-page);
		border: var(--hairline);
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.player.chrome .resume {
		bottom: calc(var(--scrub-h) + var(--cell-h) + 24px);
	}
	.resume > div {
		display: flex;
		align-items: center;
		padding: 0 20px;
	}
	/* The class names sit in :where() so the reset weighs as `a`, enough to
	   beat base.css's link colour and no more: as `a.icell` it outranked
	   `.icell`, and the link cells (← SERIES, LIBRARY) and the UP NEXT rows
	   lost their padding while the button cells beside them kept theirs. */
	button,
	a:where(.back, .icell, .up) {
		font: inherit;
		color: inherit;
		background: transparent;
		border: 0;
		border-radius: 0;
		padding: 0;
		text-decoration: none;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.resume button {
		padding: 0 20px;
		border-left: var(--hairline);
	}
	.skip {
		position: absolute;
		right: 32px;
		bottom: 32px;
		height: 56px;
		padding: 0 24px;
		background: var(--accent);
		color: var(--on-accent);
		font: 500 15px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.player.chrome .skip {
		right: 24px;
		bottom: calc(var(--scrub-h) + var(--cell-h) + 1px + 24px);
	}
	.flash {
		position: absolute;
		right: 16%;
		top: 50%;
		transform: translate(50%, -50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		padding: 16px 22px;
		background: var(--surface-page);
		border: var(--hairline);
		pointer-events: none;
	}
	.flash.back {
		right: auto;
		left: 16%;
		transform: translate(-50%, -50%);
	}
	.flash .by {
		font: 500 28px var(--font-mono);
	}
	.flash .to {
		font: 400 14px var(--font-mono);
		color: var(--text-2);
	}
	.panel {
		position: absolute;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		background: var(--surface-page);
		border: var(--hairline);
		display: flex;
		flex-direction: column;
	}
	.buffer {
		width: min(440px, calc(100% - 32px));
	}
	.buffer .body {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 20px 24px;
	}
	.buffer .head {
		display: flex;
		justify-content: space-between;
		font: 500 16px var(--font-mono);
	}
	.buffer .ink {
		height: 2px;
		background: var(--text-1);
	}
	.m {
		font: 400 13px/1.45 var(--font-mono);
		color: var(--text-2);
	}
	.buffer > button,
	.servers .foot button {
		height: 56px;
		border-top: var(--hairline);
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.servers {
		width: min(600px, calc(100% - 32px));
	}
	.servers .head {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 20px 24px;
		border-bottom: var(--hairline);
		font: 500 15px var(--font-mono);
	}
	.mut {
		color: var(--text-2);
	}
	.srow {
		display: flex;
		align-items: stretch;
		height: 56px;
		border-bottom: var(--hairline);
		color: var(--text-2);
		font: 500 14px var(--font-mono);
	}
	.srow.on {
		background: var(--surface-panel);
		color: var(--text-1);
	}
	.srow .mk {
		width: 56px;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		border-right: var(--hairline);
	}
	.srow .t {
		flex: 1;
		display: flex;
		align-items: center;
		padding: 0 18px;
	}
	.srow .r {
		display: flex;
		align-items: center;
		padding: 0 24px;
		font-weight: 400;
		font-size: 13px;
	}
	.servers .foot {
		display: flex;
		align-items: stretch;
		min-height: 56px;
	}
	.servers .foot .m {
		flex: 1;
		display: flex;
		align-items: center;
		padding: 0 24px;
	}
	.servers .foot button {
		border-top: 0;
		border-left: var(--hairline);
		padding: 0 24px;
	}

	/* Offline, a kept episode playing: Player Waiting 3d's band. */
	.offband {
		position: absolute;
		left: 0;
		right: 0;
		top: 0;
		height: 48px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 24px;
		background: var(--surface-panel);
		border-bottom: var(--hairline);
		font: 500 14px var(--font-mono);
		z-index: 2;
	}
	.player.chrome .offband + .cluster ~ .top {
		top: 48px;
	}
	.tag.ink {
		font-weight: 500;
		color: var(--text-1);
	}

	/* ---- the chrome: shown on a tap, gone after a few seconds ---- */
	/* The bars fade both ways here, on the app's own timing (base.css, .appear):
	   they're kept in the page and hidden by class, so they can fade out too.
	   The cluster does not fade (c217): it sits in the middle of the picture, and
	   a box fading over the video read as a patch coming and going. It is all
	   there from its first frame and gone on the next; its ground is translucent
	   throughout (c429, below), which is a different thing from a fade. */
	.top,
	.bottom {
		transition: opacity var(--motion-appear) var(--ease);
	}
	.player:not(.chrome) .cluster,
	.player:not(.chrome) .top,
	.player:not(.chrome) .bottom {
		opacity: 0;
		pointer-events: none;
	}
	.cluster.aside {
		display: none;
	}
	.cluster {
		position: absolute;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		display: flex;
		/*
		 * Translucent, so the frame shows through while the controls are up (the
		 * owner, 2026-11-03, c429), and the glyphs at full strength. 70% of the
		 * page's ground keeps the labels at AA over a white frame (5.9:1) as
		 * well as a black one; browse-player-cluster measures both.
		 */
		background: color-mix(in oklab, var(--surface-page) 70%, transparent);
		border: var(--hairline);
	}
	.cluster button {
		width: var(--cl);
		height: var(--cl);
		display: flex;
		align-items: center;
		justify-content: center;
		font: 500 var(--cl-font) var(--font-mono);
	}
	.cluster .pp {
		gap: var(--bar-w);
		border-left: var(--hairline);
		border-right: var(--hairline);
		font-size: var(--play-font);
	}
	/* Pause is two drawn bars (Player States, "One glyph drawn, not set"). */
	.pp i,
	.pause i,
	.pcells i {
		display: block;
		width: var(--bar-w);
		height: var(--bar-h);
		background: var(--text-1);
	}
	.pause i,
	.pcells i {
		width: 4px;
		height: 16px;
	}
	.top {
		position: absolute;
		left: 0;
		right: 0;
		top: 0;
		height: var(--top-h);
		display: flex;
		align-items: stretch;
		background: var(--surface-page);
		border-bottom: var(--hairline);
	}
	.top .back {
		width: var(--top-h);
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		border-right: var(--hairline);
		font: 500 18px var(--font-mono);
	}
	.top .names {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 3px;
		padding: 0 18px;
	}
	.top .t {
		font: 500 16px/1.2 var(--font-sans);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.top .t span {
		color: var(--text-2);
		font-weight: 400;
	}
	.top .m {
		font: 400 12px var(--font-mono);
		letter-spacing: 0.04em;
		white-space: nowrap;
	}
	.top .short {
		display: none;
	}
	@media (max-height: 499px) {
		.top .t {
			font-size: 15px;
		}
		.top .long {
			display: none;
		}
		.top .short {
			display: inline;
		}
	}
	.cell {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 5px;
		padding: 0 var(--pad-x);
		border-right: var(--hairline);
		font: 500 14px var(--font-mono);
		letter-spacing: 0.02em;
		white-space: nowrap;
	}
	.top form {
		display: flex;
	}
	.top form .cell {
		height: 100%;
	}
	.top .cell {
		border-right: 0;
		border-left: var(--hairline);
		padding: 0 22px;
		letter-spacing: 0.04em;
	}
	.cell:last-child {
		border-right: 0;
	}
	/*
	 * VOL (c385): the cell keeps its place in the row; the slider rises above
	 * it, a column of the bar's own surface with the hairline, its track the
	 * scrubber's turned upright. It is open while the pointer is over either,
	 * so the gap-free stack is what keeps it open on the way up.
	 */
	.vol {
		position: relative;
		border-right: var(--hairline);
	}
	.vol > .cell {
		border-right: 0;
	}
	.volpop {
		display: none;
		position: absolute;
		bottom: 100%;
		left: 0;
		right: 0;
		height: 148px;
		padding: 16px 0;
		background: var(--surface-page);
		border: var(--hairline);
		border-bottom: 0;
	}
	.vol:hover .volpop,
	.vol.open .volpop {
		display: block;
	}
	.vtrack {
		position: relative;
		width: 4px;
		height: 100%;
		margin: 0 auto;
		background: var(--line-1);
		touch-action: none;
		cursor: pointer;
	}
	.vtrack::before {
		/* A pointer's worth of target around a 4px line: the column's width. */
		content: '';
		position: absolute;
		inset: -16px -20px;
	}
	.vtrack .vfill {
		position: absolute;
		left: 0;
		bottom: 0;
		width: 4px;
		background: var(--accent);
	}
	.vtrack .vthumb {
		position: absolute;
		left: -10px;
		width: 24px;
		height: 4px;
		margin-bottom: -2px;
		background: var(--text-1);
	}
	.cell.grow {
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.desk {
		display: none;
	}
	/* The TV's own two cells: `−10` and `+10`, beside ▶❚❚ (TV-Board-Player 6B). */
	.cell.tv {
		display: none;
	}
	@media (pointer: fine) and (min-height: 500px) {
		.desk {
			display: flex;
		}
		.cell.pause {
			padding: 0 22px;
		}
	}
	@media (max-height: 499px) {
		.cell {
			font-size: 13px;
		}
	}
	.cells {
		display: flex;
		align-items: stretch;
		height: var(--cell-h);
		border-top: var(--hairline);
	}
	.endcard {
		position: absolute;
		right: 32px;
		bottom: calc(var(--scrub-h) + var(--cell-h) + 32px);
		width: min(460px, calc(100% - 64px));
		background: var(--surface-page);
		border: var(--hairline);
		display: flex;
		flex-direction: column;
	}
	.player:not(.chrome) .endcard {
		bottom: 32px;
	}
	.endcard .row {
		display: flex;
		gap: 16px;
		padding: 20px 22px;
	}
	.pic {
		width: 128px;
		height: 72px;
		flex-shrink: 0;
		background: repeating-linear-gradient(
			135deg,
			var(--surface-panel) 0 8px,
			var(--line-1) 8px 16px
		);
		/* The episode's picture, where it has one (c225), replaces the stripes. */
		background-size: cover;
		background-position: center;
	}
	.endcard .txt {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.endcard .k {
		font: 500 12px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.endcard .t {
		font: 500 20px/1.2 var(--font-sans);
	}
	.endcard .m,
	.endcard .when {
		font: 400 12px var(--font-mono);
		color: var(--text-2);
	}
	.endcard .when {
		padding: 0 22px 16px;
		font-size: 13px;
	}
	/* The Work's next part where the end card is (Work-EndStates 3) ----------- */
	.upn {
		position: absolute;
		right: 32px;
		bottom: calc(var(--scrub-h) + var(--cell-h) + 32px);
		width: min(460px, calc(100% - 64px));
		display: flex;
		flex-direction: column;
		background: var(--surface-page);
		border: var(--hairline);
	}
	.player:not(.chrome) .upn {
		bottom: 32px;
	}
	.upn .k {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 14px 18px 10px;
		font: 500 12px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.upn .bd {
		display: flex;
		gap: 16px;
		padding: 0 18px 16px;
	}
	.upn .bd .cv {
		display: block;
		width: 64px;
		flex-shrink: 0;
	}
	.upn .bd .t {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}
	.upn .bd .t .a {
		font: 500 18px/1.25 var(--font-sans);
	}
	.upn .bd .t .b {
		font: 400 12px var(--font-mono);
		color: var(--text-2);
	}
	.upn .acts {
		display: flex;
		height: 56px;
		border-top: var(--hairline);
	}
	.upn .acts > * {
		display: flex;
		align-items: center;
		padding: 0 18px;
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
		border-left: var(--hairline);
		white-space: nowrap;
		color: var(--text-1);
		text-decoration: none;
		background: transparent;
		border-top: 0;
		border-right: 0;
		border-bottom: 0;
		cursor: pointer;
	}
	.upn .acts > .acc {
		flex: 1;
		justify-content: space-between;
		background: var(--accent);
		color: var(--on-accent);
		border-left: 0;
	}
	/* In the end-of-episode page it sits in the column, not over the picture. */
	.inter .upn {
		position: static;
		width: 100%;
		max-width: 460px;
	}
	.two {
		display: grid;
		grid-template-columns: 1fr 1fr;
		border-top: var(--hairline);
	}
	.two button {
		height: 56px;
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.acc {
		background: var(--accent) !important;
		color: var(--on-accent) !important;
	}

	/* ---- the settings sheet: a 520px side sheet, the picture playing beside it ---- */
	.scrim {
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		right: 520px;
		background: rgba(0, 0, 0, 0.6);
	}
	.keys-scrim {
		right: 440px;
	}
	.sheet {
		position: absolute;
		right: 0;
		top: 0;
		bottom: 0;
		width: 520px;
		max-width: 100%;
		box-sizing: border-box;
		background: var(--surface-page);
		border-left: 1px solid var(--text-1);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.sheet.keys {
		width: 440px;
	}
	.shead {
		flex-shrink: 0;
		display: flex;
		align-items: stretch;
		height: 56px;
		border-bottom: var(--hairline);
	}
	.shead > div {
		flex: 1;
		display: flex;
		align-items: center;
		padding: 0 24px;
		font: 500 13px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.shead button {
		width: 56px;
		border-left: var(--hairline);
		font: 500 18px var(--font-mono);
	}
	.srows {
		flex: 1;
		overflow-y: auto;
	}
	.srow2 {
		display: flex;
		align-items: stretch;
		border-bottom: var(--hairline);
	}
	.lab {
		width: 116px;
		flex-shrink: 0;
		box-sizing: border-box;
		padding: 26px 0 0 24px;
		border-right: var(--hairline);
		font: 500 12px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.val {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px 16px;
	}
	.seg {
		display: flex;
		border: 1px solid var(--line-2);
		height: 44px;
		font: 500 14px var(--font-mono);
	}
	.seg button {
		flex: 1;
		min-width: 0;
		border-left: 1px solid var(--line-2);
	}
	.seg button:first-child {
		border-left: 0;
	}
	.seg button.on {
		background: var(--text-1);
		color: var(--surface-page);
	}
	/*
	 * AUDIO and SUBTITLES (c386): equal cells as many to a line as fit (six in
	 * the 520px sheet, four on a TV's 420px panel), wrapping, each a tap high.
	 * A segmented row squeezed thirty languages into one line. The lines are
	 * the cells' own right and bottom borders inside the grid's top and left,
	 * so a short last line still closes.
	 */
	.langs {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(60px, 1fr));
		border-top: 1px solid var(--line-2);
		border-left: 1px solid var(--line-2);
		font: 500 13px var(--font-mono);
	}
	.langs button {
		min-width: 0;
		min-height: 44px;
		padding: 0 2px;
		border-right: 1px solid var(--line-2);
		border-bottom: 1px solid var(--line-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.langs button.on {
		background: var(--text-1);
		color: var(--surface-page);
	}
	.langs .more {
		grid-column: span 2;
	}
	.langs .more[aria-expanded='true'] {
		color: var(--accent);
	}
	.langlist {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.li {
		display: flex;
		align-items: center;
		gap: 12px;
		height: 44px;
		padding: 0 12px !important;
		border: 1px solid var(--line-2) !important;
		font: 500 14px var(--font-mono);
		text-align: left;
	}
	.li span:first-child {
		flex: 1;
	}
	.li .r {
		font-weight: 400;
		font-size: 12px;
		color: var(--text-2);
	}
	.li.on {
		border-color: var(--accent) !important;
	}
	.li.on .r {
		color: var(--accent);
	}
	.li.off {
		color: var(--text-2);
	}
	.note {
		font: 400 12px/1.4 var(--font-mono);
		color: var(--text-2);
	}
	.dimrow {
		display: flex;
		align-items: center;
		gap: 16px;
		height: 44px;
		font: 500 14px var(--font-mono);
	}
	.dimrow input {
		flex: 1;
		accent-color: var(--text-1);
	}
	.sfoot {
		padding: 14px 24px;
		font: 400 12px/1.5 var(--font-mono);
		color: var(--text-2);
	}
	.krow {
		display: flex;
		align-items: stretch;
		min-height: 56px;
		border-bottom: var(--hairline);
	}
	.krow .k {
		width: 112px;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		padding-left: 24px;
		box-sizing: border-box;
		border-right: var(--hairline);
		font: 500 14px var(--font-mono);
	}
	.krow .a {
		flex: 1;
		display: flex;
		align-items: center;
		padding: 0 18px;
		font: 400 15px var(--font-sans);
	}
	@media (max-width: 699px) {
		.scrim,
		.keys-scrim {
			right: 0;
		}
	}

	/* ---- waits and ends: the reader's end-of-chapter page ---- */
	.inter {
		position: absolute;
		inset: 0;
		background: var(--surface-page);
		display: flex;
		flex-direction: column;
	}
	.imid {
		flex: 1;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 36px;
		padding: 0 96px;
	}
	@media (max-width: 799px) {
		.imid {
			padding: 0 24px;
		}
	}
	.kick {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		font: 500 13px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.rule {
		height: 1px;
		background: var(--line-1);
	}
	/* The Loading States ink line: the workstation is working, never a faked fill. */
	.rule.ink {
		height: 2px;
		background: var(--text-1);
	}
	.what {
		display: flex;
		flex-direction: column;
		gap: 12px;
		max-width: 820px;
	}
	.label {
		font: 500 13px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.big {
		font: 500 44px/1.15 var(--font-sans);
	}
	.big.faint {
		opacity: 0.4;
	}
	.tag {
		font: 400 15px var(--font-mono);
		color: var(--text-2);
	}
	.scale {
		position: relative;
		height: 64px;
		max-width: 820px;
		font: 400 12px var(--font-mono);
		color: var(--text-2);
	}
	.scale > div {
		position: absolute;
	}
	.scale .base {
		left: 0;
		right: 0;
		top: 30px;
		height: 2px;
		background: var(--line-1);
	}
	.scale .range {
		top: 28px;
		height: 6px;
		background: var(--line-2);
	}
	.scale .done {
		left: 0;
		top: 30px;
		height: 2px;
		background: var(--text-1);
	}
	.scale .mark {
		top: 20px;
		width: 2px;
		height: 22px;
		margin-left: -1px;
		background: var(--text-1);
	}
	.scale .now {
		top: 0;
		transform: translateX(-50%);
		font: 500 13px var(--font-mono);
		color: var(--text-1);
	}
	.scale .n0 {
		left: 0;
		top: 46px;
	}
	.scale .n20,
	.scale .n45 {
		top: 46px;
		transform: translateX(-50%);
	}
	.scale .n60 {
		right: 0;
		top: 46px;
	}
	.count {
		display: flex;
		flex-direction: column;
		gap: 12px;
		max-width: 820px;
	}
	.count .c {
		font: 500 16px var(--font-mono);
		color: var(--accent);
	}
	.count .bar {
		height: 2px;
		background: var(--line-1);
	}
	.count .bar div {
		height: 2px;
		background: var(--accent);
		transition: width 1s linear;
	}
	.prose {
		font: 400 18px/1.5 var(--font-sans);
		color: var(--text-2);
		max-width: 600px;
		text-wrap: pretty;
	}
	/* "Not just this episode" (doc/MOVE.md; Migrate Calls, PLAYER). */
	.also {
		display: flex;
		flex-direction: column;
		gap: 6px;
		max-width: 720px;
		padding-top: 4px;
	}
	.also .a {
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
		color: var(--text-1);
	}
	.also .b {
		font: 400 13px/1.45 var(--font-mono);
		color: var(--text-2);
	}
	.icells {
		flex-shrink: 0;
		display: flex;
		border-top: var(--hairline);
		height: 64px;
	}
	.icell {
		display: flex;
		align-items: center;
		padding: 0 24px;
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.icell.flex {
		flex: 1;
	}
	.icell.br {
		border-right: var(--hairline);
	}
	.icell.bl {
		border-left: var(--hairline);
	}

	/* ---- portrait: the picture on top, the controls always shown beneath ---- */
	.portrait {
		display: none;
	}
	@media (orientation: portrait) {
		.stage {
			top: 56px;
			bottom: auto;
			height: calc(100vw * 9 / 16);
		}
		.cluster,
		.top,
		.bottom,
		.endcard,
		.player > .upn {
			display: none;
		}
		.subs,
		.player.chrome .subs {
			bottom: 8px;
		}
		.line {
			font-size: 14px;
		}
		/* A layer of its own over the picture, letting taps through to it. */
		.portrait {
			display: block;
			position: absolute;
			inset: 0;
			pointer-events: none;
		}
		.portrait > * {
			pointer-events: auto;
		}
		.skip,
		.player.chrome .skip {
			right: 12px;
			bottom: auto;
			top: calc(56px + 100vw * 9 / 16 - 56px - 12px);
		}
	}
	.pbar {
		position: absolute;
		left: 0;
		right: 0;
		top: 0;
		height: 56px;
		display: flex;
		align-items: stretch;
		background: var(--surface-page);
		border-bottom: var(--hairline);
	}
	.pbar .back {
		width: 56px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-right: var(--hairline);
		font: 500 17px var(--font-mono);
	}
	.pbar .m {
		flex: 1;
		display: flex;
		align-items: center;
		padding: 0 14px;
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.pbar form {
		display: flex;
	}
	.pbar button {
		padding: 0 16px;
		border-left: var(--hairline);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.pbody {
		position: absolute;
		left: 0;
		right: 0;
		/* Under the picture and the 44px scrubber with its 1px rule. */
		top: calc(56px + 100vw * 9 / 16 + 45px);
		bottom: 0;
		overflow-y: auto;
		background: var(--surface-page);
	}
	.pscrub {
		position: absolute;
		left: 0;
		right: 0;
		top: calc(56px + 100vw * 9 / 16);
		box-sizing: content-box;
		background: var(--surface-page);
		display: flex;
		align-items: center;
		gap: 12px;
		height: 44px;
		padding: 0 16px;
		border-bottom: var(--hairline);
		font: 500 12px var(--font-mono);
	}
	.pscrub .track .thumb {
		top: -8px;
		height: 20px;
	}
	/* The whole 44px row is the finger's target, not the 4px line (c387). */
	.pscrub .track::before {
		inset: -20px 0;
	}
	.pcells {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		height: 56px;
		border-bottom: var(--hairline);
		font: 500 14px var(--font-mono);
	}
	.pcells button {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 5px;
		border-right: var(--hairline);
	}
	.pcells button:last-child {
		border-right: 0;
	}
	.pcells .small {
		font-size: 12px;
	}
	.pnames {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 16px;
		border-bottom: var(--hairline);
	}
	.pnames .k {
		font: 500 12px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.pnames .t {
		font: 500 20px/1.2 var(--font-sans);
	}
	.pnames .s {
		font: 400 15px var(--font-sans);
		color: var(--text-2);
	}
	.plabel {
		display: flex;
		justify-content: space-between;
		padding: 16px 16px 10px;
		font: 500 12px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.up {
		display: flex;
		align-items: center;
		gap: 12px;
		height: 64px;
		padding: 0 16px;
		border-top: var(--hairline);
	}
	.up .n {
		width: 24px;
		font: 500 13px var(--font-mono);
		color: var(--text-2);
	}
	.up .pic {
		width: 72px;
		height: 40px;
	}
	.up .txt {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.up .t {
		font: 500 15px var(--font-sans);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.up .m {
		font: 400 11px var(--font-mono);
	}

	/* A hidden series plays inside the reveal frame, as a hidden book reads. */
	.reveal {
		position: absolute;
		inset: 0;
		box-shadow: inset 0 0 0 4px var(--reveal);
		pointer-events: none;
		z-index: 10;
	}
	.dashed {
		position: absolute;
		inset: 0;
		border: 2px dashed var(--line-2);
		pointer-events: none;
		z-index: 10;
	}

	.bottom {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		background: var(--surface-page);
		border-top: var(--hairline);
		display: flex;
		flex-direction: column;
	}
	.scrubrow {
		display: flex;
		align-items: center;
		gap: 18px;
		height: var(--scrub-h);
		padding: 0 var(--pad-x);
	}
	.scrubrow .e {
		font: 500 13px var(--font-mono);
		min-width: 44px;
	}
	.scrubrow .l {
		font: 500 13px var(--font-mono);
		color: var(--text-2);
		min-width: 52px;
		text-align: right;
	}
	.track {
		position: relative;
		flex: 1;
		height: 4px;
		background: var(--line-1);
		touch-action: none;
		cursor: pointer;
	}
	.track::before {
		/* A finger's worth of target around a 4px line. */
		content: '';
		position: absolute;
		inset: -14px 0;
	}
	.track .buf,
	.track .seen {
		position: absolute;
		left: 0;
		top: 0;
		height: 4px;
		/* Seen over video: line-2 on line-1 wasn't (reported 2026-10-29). */
		background: var(--text-2);
	}
	.track .seen {
		background: var(--accent);
	}
	.track .tick {
		position: absolute;
		top: -9px;
		width: 1px;
		height: 22px;
		background: var(--text-2);
	}
	.track .thumb {
		position: absolute;
		top: -10px;
		width: 4px;
		height: 24px;
		margin-left: -2px;
		background: var(--text-1);
	}
	.track .hover {
		position: absolute;
		top: -10px;
		width: 1px;
		height: 24px;
		background: var(--text-2);
	}
	.track .tip {
		position: absolute;
		bottom: 22px;
		transform: translateX(-50%);
		padding: 6px 10px;
		background: var(--surface-inverse);
		color: var(--text-inverse);
		font: 500 13px var(--font-mono);
		pointer-events: none;
		/* Half the tip with a frame (160 + its hairlines + padding): how far from
		   the track's ends its middle may come, so the frame stays inside (c385). */
		--tip-half: 87px;
	}
	.track .tip.pic {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		padding: 6px;
	}
	.track .tip .frame {
		width: 160px;
		height: 90px;
		border: var(--hairline);
		background-color: var(--surface-page);
		background-repeat: no-repeat;
	}
	/*
	 * The settings panel on a TV (c235): the 420px panel every sheet is there
	 * (c238), with the picture playing at the left, its scrim stopping where
	 * the panel starts (TV-Player 6E).
	 */
	@media (pointer: none) and (min-width: 900px) {
		.scrim {
			right: var(--tv-panel-w);
		}
		.sheet {
			width: var(--tv-panel-w);
			max-width: var(--tv-panel-w);
		}
	}
	/*
	 * The player on a TV (c235; TV-Player): the safe margin applies to both
	 * bars, the scrubber is 60px over 56px cells, and the six cells are one
	 * closed row. The middle cluster is the thumb's -- on a TV, the picture is
	 * the interface until a key (6A), and then the bar is everything (6B).
	 *
	 * The margin is inside the bars, not around them: each bar reaches its edge
	 * of the screen and keeps what it holds 28px from the top or bottom and 48px
	 * from the sides (TV-Player: 28 0 0 / 0 0 28 padding, 48 either side). Set
	 * around them, the picture showed above the top bar and under the cells
	 * (2026-11-02, the first real TV).
	 */
	@media (pointer: none) and (min-width: 900px) {
		.player {
			--top-h: 56px;
			--scrub-h: 60px;
			--cell-h: 56px;
			--pad-x: 16px;
		}
		.top {
			top: 0;
			height: calc(var(--top-h) + var(--safe-y) + 1px);
			padding: var(--safe-y) var(--pad) 0;
		}
		.top .back {
			width: auto;
			justify-content: flex-start;
			padding-right: 22px;
		}
		.bottom {
			bottom: 0;
			padding: 0 var(--pad) var(--safe-y);
		}
		.cells {
			border: var(--hairline);
		}
		.cells > :last-child {
			border-right: 0;
		}
		.cluster {
			display: none;
		}
		/*
		 * The bar's cells start at the screen's edge while the line starts after
		 * the time, so ▶❚❚ (49–125) did not overlap the line (126–826): ↑ from it
		 * took the far-away top bar's ←, which does overlap, because an
		 * overlapping candidate wins over a nearer one out of line (c296). The
		 * transparent border reaches the element's own box under that first
		 * cell without moving the line: the fill is clipped to the padding box
		 * and its children are positioned from there, so the bar looks the same
		 * and ↑ from any cell in the row lands on it.
		 *
		 * Only here, where nothing points (c315): set on every bar, the border
		 * was a 20px strip between the time and the line that a click or a tap
		 * turned into a seek to 0:00, where before it was inert.
		 */
		.track {
			margin-left: -20px;
			border-left: 20px solid transparent;
			background-clip: padding-box;
		}
		.cells .pause,
		.cells .cell.tv {
			display: flex;
			flex: 0 0 76px;
			padding: 0;
		}
		.cells .grow {
			flex: 1 1 auto;
		}
		.skip {
			right: var(--pad);
			bottom: calc(var(--safe-y) + 24px);
		}
		.player.chrome .skip {
			right: var(--pad);
			bottom: calc(var(--safe-y) + var(--scrub-h) + var(--cell-h) + 1px + 24px);
		}
		.endcard {
			right: var(--pad);
			bottom: calc(var(--safe-y) + var(--scrub-h) + var(--cell-h) + 24px);
		}
	}
</style>
