<script lang="ts">
	import { updateRun } from '$lib/update-run.svelte';
	import { appUpdater } from '$lib/app/update.svelte';
	import { appLine, type AppUpdate } from '$lib/app/update';
	import { m } from '$lib/paraglide/messages';
	import StartTrail from '$lib/components/start/StartTrail.svelte';
	import HelpMark from '$lib/components/help/HelpMark.svelte';
	import HelpSheet from '$lib/components/help/HelpSheet.svelte';
	import { onMount } from 'svelte';
	import { enhance, deserialize } from '$app/forms';
	import { afterNavigate, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { MediaQuery } from 'svelte/reactivity';
	import Band from '$lib/components/chrome/Band.svelte';
	import QrCode from '$lib/components/content/QrCode.svelte';
	import { offline } from '$lib/offline.svelte';
	import { SERVICE_NAME, clock, type Service } from '$lib/library/tracking';
	import type { AccountView } from '$lib/server/tracking';
	import {
		DEVICE_KEYS,
		SECTIONS,
		VALUES,
		deviceChanged,
		deviceName,
		deviceWord,
		equal,
		isChanged,
		movesLine,
		keptOf,
		ORIGINAL_ONLY,
		resetMoves,
		rowChanged,
		scopeLabel,
		sectionChanged,
		sectionFor,
		valueDef,
		valueLabel,
		type DeviceKind,
		type Json,
		type RowDef,
		type SectionDef,
		type SectionId,
		type ValueId,
		type Values
	} from '$lib/settings/catalog';
	import { deviceValues, plain, writeValue } from '$lib/settings/stamped';
	import {
		deviceId,
		onLocalChange,
		readLocal,
		syncDevice,
		thisKind,
		writeLocal
	} from '$lib/settings/local';
	import { audioLine, differ, inUse, overrideLine, subsLine, when } from '$lib/settings/lines';
	import { clampZoom, stepZoom, zoomLabel } from '$lib/reader/zoom';
	import { modeLine } from './mode-line';
	import { SIZE_MAX, SIZE_MIN, baseFontSize, deviceOf } from '$lib/reader/text';

	/**
	 * SETTINGS, one page (doc/SETTINGS.md; card c171, Settings.dc.html): every
	 * setting once, in eight sections, each row ending in where it's kept. A
	 * value off its default carries accent's rule and RESET; RESET SECTION
	 * applies at once and says what moved, with UNDO. No modal anywhere.
	 */
	let { data, form } = $props();
	/**
	 * WI-FI (doc/WIFI.md; Wifi.dc.html): the server's view, overridden by ON,
	 * OFF and NEW CODE, and polled while the panel is open, so the code counts
	 * down by the minute and turns USED when a phone scans it.
	 */
	type Wifi = NonNullable<typeof data.wifi>;
	let wf = $derived<Wifi | null>(data.wifi);
	let wifiBusy = $state(false);
	/** The firewall's disclosure under the pairing panel (c721), closed until asked. */
	let fwOpen = $state(false);
	async function wifiPost(action: 'on' | 'off' | 'code') {
		wifiBusy = true;
		// The first time on Windows, STARTING… stays long enough to read: that's
		// when the firewall dialog appears, maybe behind the browser (2A).
		const hold =
			action === 'on' && wf?.firstTime && /Windows/.test(navigator.userAgent)
				? new Promise((ok) => setTimeout(ok, 4000))
				: null;
		try {
			// Asked at once: the dialog comes with the listening, the hold only keeps the words up.
			const [r] = await Promise.all([
				fetch('/api/wifi', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ action })
				}),
				hold
			]);
			if (r.ok) wf = (await r.json()) as Wifi;
		} finally {
			wifiBusy = false;
		}
	}
	$effect(() => {
		if (!wf?.on || data.viaLan) return;
		const usedBefore = wf.code?.state === 'used';
		const t = setInterval(async () => {
			// A late answer to an earlier ask: NEW CODE, ON or OFF answered while
			// this poll was out, and theirs is the newer view (c461's class).
			const asked = wf;
			try {
				const r = await fetch('/api/wifi', { cache: 'no-store' });
				if (!r.ok || wf !== asked) return;
				const next = (await r.json()) as Wifi;
				if (wf !== asked) return;
				wf = next;
				// A phone just paired: its row appears in the list below.
				if (!usedBefore && next.code?.state === 'used') void invalidateAll();
			} catch {
				// Not answering for a moment: the next tick tries again.
			}
		}, 5000);
		return () => clearInterval(t);
	});
	/**
	 * The TV's six digits where there is no WI-FI panel to carry them (c245):
	 * the owner's tailnet install. Their countdown is the page's own, ticked
	 * from the moment the server says they stop working -- the install has no
	 * `/api/wifi` to poll, and `/api/pair/tv` answers at the computer only.
	 * What the code itself is comes from `GET /settings/tv` (`refreshTv`).
	 */
	type Tv = NonNullable<typeof data.tv>;
	let tv = $derived<Tv | null>(data.tv);
	let tvBusy = $state(false);
	let tvNow = $state(Date.now());
	$effect(() => {
		if (!tv || tv.state !== 'live') return;
		const t = setInterval(() => (tvNow = Date.now()), 15_000);
		return () => clearInterval(t);
	});
	const tvLive = (t: Tv) => t.state === 'live' && tvNow < t.expiresAt;
	const tvMinutes = (t: Tv) => Math.max(0, Math.ceil((t.expiresAt - tvNow) / 60_000) - 1);
	/**
	 * A TV that pairs with the code, or burns it, while SETTINGS stays open
	 * changes nothing on this page by itself, and a spent code left showing as
	 * live invites a second TV to type it (c265). So the row asks the server
	 * what the code is now: every 5 s while it shows anything but a burned code
	 * and the page is in view, and once whenever the window regains focus or the page
	 * becomes visible again. The owner usually keeps SETTINGS in front while
	 * typing on the TV, so focus alone would miss the common case.
	 *
	 * The answer is drawn as it is. Only a code that has just become USED
	 * reloads the page's data, so the TV that paired joins the list below (the
	 * WI-FI panel's `usedBefore`). A burned or expired code stays on the row,
	 * and a reload of the page's data leaves it so: only a real visit renews
	 * (c531, `settingsVisit`). A new code comes from NEW CODE, from opening
	 * SETTINGS again, or from the TV's own /pair/tv (c246, `renewForTv`), in
	 * place of none, a merely expired one, or one used over 2 minutes ago,
	 * which the 5 s poll then draws. The row is asked about with no code at
	 * all too (`data.tvHere`, round 2): after a restart the server has none
	 * until a visit or a TV makes one.
	 *
	 * An answer is about the code the row showed when it asked. If NEW CODE (or
	 * any reload of the page's data) replaced `tv` while it was out, the answer
	 * is the old code's, burned or used, and drawing it would put the old code
	 * back over the new live one (c461). `tv` is a `$derived` that the reload
	 * recomputes to a new object and this assigns, so identity is the test:
	 * nothing else writes it.
	 */
	async function refreshTv() {
		const before = tv;
		if (!data.tvHere) return;
		try {
			const r = await fetch('/settings/tv', { cache: 'no-store' });
			if (!r.ok || tv !== before) return;
			const { tv: next } = (await r.json()) as { tv: Tv | null };
			if (tv !== before) return;
			if (next?.code === before?.code && next?.state === before?.state) return;
			tv = next;
			if (next?.state === 'used' && before?.state !== 'used') await invalidateAll();
		} catch {
			// Not answering for a moment: the next tick, or the next focus, asks again.
		}
	}
	// Keyed on the state alone, not `tvLive`: that reads the 15 s countdown, which
	// would tear the interval down and rebuild it, losing one tick in three.
	// Every state but burned is asked about, and so is no code at all: an
	// unpaired TV opening /pair/tv makes a new code in place of none, a merely
	// expired one, or one used over 2 minutes ago (c246, `renewForTv`), and
	// says THE NEW ONE IS ON THE COMPUTER, so the row must draw it without
	// waiting for a focus the owner, typing on the TV, never gives (round 2:
	// a second TV paired with SETTINGS left on ✓ USED). A burned code is not
	// asked about: only the computer replaces it, and its own doors (NEW CODE,
	// a real visit) redraw the row.
	const tvPolls = $derived(data.tvHere && tv?.state !== 'burned');
	$effect(() => {
		if (!tvPolls) return;
		const t = setInterval(() => {
			if (document.visibilityState === 'visible') void refreshTv();
		}, 5000);
		return () => clearInterval(t);
	});
	const tvBack = () => {
		if (document.visibilityState === 'visible') void refreshTv();
	};
	async function newTvCode() {
		tvBusy = true;
		try {
			await act('tvCode', []);
		} finally {
			tvBusy = false;
		}
	}
	/**
	 * Arriving here from another screen is a real visit, which renews a spent
	 * code (c531): opened as a document, the load itself renews; arrived at by
	 * a client-side navigation, the load was a data request like any reload of
	 * this page's data, which must not renew, so the page says so itself with
	 * `?/renew` and then reloads to draw the result (`act`). Not on a change of
	 * this page's own URL (`?section=`), not where neither row is drawn, and
	 * not over Wi-Fi, where `?/renew` renews nothing (c460). Whether the TV's
	 * row is here is the server's `tvHere`, never `data.tv`: after a restart
	 * there is no code, so `data.tv` is null on exactly the visit that must
	 * make one (round 2).
	 */
	afterNavigate((nav) => {
		if (nav.type === 'enter' || nav.from?.route.id === nav.to?.route.id) return;
		if (data.viaLan || (!data.wifi && !data.tvHere)) return;
		void act('renew', []);
	});

	const wifiMeta = (w: Wifi) => {
		if (w.reach === 'public')
			return `CAN'T BE SWITCHED ON HERE · THIS COMPUTER'S ONLY ADDRESS IS PUBLIC (${w.address}): IT SEEMS PLUGGED STRAIGHT INTO THE MODEM, SO THE SIGN-IN PAGE WOULD FACE THE INTERNET · CONNECT IT THROUGH THE ROUTER, BY WI-FI OR CABLE, AND THIS COMES BACK`;
		if (!w.on)
			return "LETS A PHONE OR TABLET ON THIS WI-FI OPEN TSUNDOKU, BY SCANNING A CODE · ANYONE ON THE SAME WI-FI REACHES THE SIGN-IN PAGE: FINE AT HOME, NOT ON A CAFÉ'S OR A DORM'S";
		if (wifiBusy && !w.listening)
			return 'TURNING ON · TSUNDOKU STARTS LISTENING ON THE WI-FI, WHICH TAKES A FEW SECONDS';
		return "ON · ANYONE ON THIS WI-FI REACHES THE SIGN-IN PAGE · SWITCH IT OFF ON A CAFÉ'S OR A DORM'S · THIS COMPUTER KEEPS USING LOCALHOST";
	};
	/** A paired phone's line in DEVICES (Wifi.dc.html's device rows). */
	const pairedMeta = (p: { address: string; pairedAt: number }, mine: boolean, n: number) => {
		const w = wf;
		if (w?.changed && p.address.startsWith(`${w.changed.from}:`))
			return `PAIRED AT ${w.changed.from} · SCAN AGAIN`;
		if (w && !w.on) return "OVER WI-FI · CAN'T REACH IT WHILE WI-FI IS OFF · STAYS SIGNED IN";
		if (w && !w.listening) return "OVER WI-FI · CAN'T REACH IT UNTIL THERE'S AN ADDRESS";
		// No WI-FI panel means it paired on the tailnet (c245): the row says so.
		const door = w ? 'OVER WI-FI' : 'OVER TAILSCALE';
		if (Date.now() - p.pairedAt < 60_000) return `${door} · JUST PAIRED · ${changedWord(n)}`;
		return `${door} · PAIRED ${when(p.pairedAt)}${mine ? ' · OPEN NOW' : ''}`;
	};

	/** A "?"'s sheet, open on a topic's part (doc/HELP.md). */
	let helpAt = $state<{ topic: string; part: string } | null>(null);

	/** The PASSWORD row's open form, if any (doc/SIGN-IN.md). */
	let pw = $state<null | 'set' | 'remove'>(null);

	/**
	 * UPDATES (doc/UPDATES.md): the server's view, refreshed by CHECK and polled
	 * while an install runs. The installer stops this server and starts the new
	 * one, so the poll goes unanswered for a while, then reloads onto it.
	 */
	type Updates = NonNullable<typeof data.updates>;
	// The server's view, overridden by CHECK and the poll until the page loads again.
	let upd = $derived<Updates | null>(data.updates);
	let checkingUpdates = $state(false);
	async function checkUpdates() {
		checkingUpdates = true;
		try {
			const r = await fetch('/api/updates', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ action: 'check' })
			});
			if (r.ok) upd = (await r.json()) as Updates;
		} finally {
			checkingUpdates = false;
		}
	}
	// UPDATE runs the one loop the update modal runs too (lib/update-run.svelte.ts).
	function installUpdate() {
		const target = upd?.available?.version;
		if (target) void updateRun.start(target);
	}
	$effect(() => {
		if (updateRun.view) upd = updateRun.view;
	});
	// The band on the library has done its job once SETTINGS is open.
	$effect(() => {
		const v = data.updates?.available?.version;
		if (!v) return;
		try {
			localStorage.setItem('tsundoku.update.seen', v);
		} catch {
			// Storage refused: the band shows again, no harm.
		}
	});
	const updateLine = (u: Updates) => {
		const i = u.install;
		if (i?.phase === 'downloading')
			return `DOWNLOADING ${i.total ? Math.floor((i.bytes / i.total) * 100) : 0}%`;
		if (i?.phase === 'installing') return 'INSTALLING · TSUNDOKU WILL REOPEN BY ITSELF';
		if (i?.phase === 'failed') return `UPDATE FAILED · ${i.error.toUpperCase()}`;
		if (u.available) return `${u.available.version} IS OUT · ${u.available.date}`;
		if (u.error) return `COULDN'T CHECK · ${u.error.toUpperCase()}`;
		return u.checkedAt ? `UP TO DATE · CHECKED ${when(u.checkedAt)}` : 'NOT CHECKED YET';
	};

	// ---- where the page is drawn -------------------------------------------------------------
	const phone = new MediaQuery('(max-width: 599px)', false);
	const wide = new MediaQuery('(min-width: 1024px)', false);
	const desktop = new MediaQuery('(min-width: 1024px) and (pointer: fine)', false);
	const off = $derived(!offline.online);

	// ---- this device, and the one shown (2C) -------------------------------------------------
	let myId = $state('');
	let myKind = $state<DeviceKind>('tablet');
	/** This browser's storage, by key: what its rows read. */
	let local = $state<Record<string, Json>>({});
	let showing = $state<string | null>(null);
	const readAll = () =>
		Object.fromEntries(
			DEVICE_KEYS.flatMap((k) => {
				const v = readLocal<Json | undefined>(k, undefined);
				return v === undefined ? [] : [[k, v]];
			})
		);
	onMount(() => {
		myId = deviceId();
		myKind = thisKind();
		local = readAll();
		const stop = onLocalChange(() => (local = readAll()));
		// A visit here checks in, so the DEVICES section lists this one as it is now.
		void syncDevice({ register: true }).then((ok) => {
			if (ok) void invalidateAll();
		});
		const target = sectionFor(page.url.searchParams.get('section') ?? '');
		if (target) document.getElementById(`s-${target}`)?.scrollIntoView();
		return stop;
	});
	const other = $derived(
		showing && showing !== myId ? (data.devices.find((d) => d.id === showing) ?? null) : null
	);
	const store = $derived(other ? plain(other.settings) : local);
	const deviceIds = (Object.keys(VALUES) as ValueId[]).filter(
		(id) => valueDef(id).where === 'device'
	);
	const values = $derived<Values>({ ...data.values, ...deviceValues(deviceIds, store) });
	const shownKind = $derived(other ? other.kind : myKind);
	const devName = $derived(deviceName(shownKind, !other));
	const kindWord = (k: DeviceKind) => k.toUpperCase();

	// ---- setting ----------------------------------------------------------------------------
	async function act(name: string, fields: [string, string][]): Promise<boolean> {
		const body = new FormData();
		for (const [k, v] of fields) body.append(k, v);
		try {
			const res = await fetch(`?/${name}`, {
				method: 'POST',
				body,
				headers: { 'x-sveltekit-action': 'true' }
			});
			const r = deserialize(await res.text());
			await invalidateAll();
			return r.type === 'success';
		} catch {
			return false;
		}
	}

	/** Set or reset (undefined) several values at once: the library's in one request. */
	async function setValues(changes: { id: ValueId; v: Json | undefined }[]) {
		const lib = changes.filter((c) => valueDef(c.id).where === 'library');
		const dev = changes.filter((c) => valueDef(c.id).where === 'device');
		let st = { ...store };
		for (const c of dev) {
			const key = valueDef(c.id).key;
			const v = writeValue(c.id, st, c.v);
			st = { ...st, [key]: v };
			if (other)
				await act('device', [
					['device', other.id],
					['key', key],
					['v', JSON.stringify(v)]
				]);
			else writeLocal(key, v === null ? undefined : v);
		}
		const sets = lib.filter((c) => c.v !== undefined);
		const resets = lib.filter((c) => c.v === undefined);
		if (sets.length)
			await act(
				'set',
				sets.flatMap((c): [string, string][] => [
					['id', c.id],
					['v', JSON.stringify(c.v)]
				])
			);
		if (resets.length)
			await act(
				'set',
				resets.map((c): [string, string] => ['id', c.id])
			);
	}
	const set = (id: ValueId, v: Json) =>
		setValues([{ id, v: equal(v, valueDef(id).def) ? undefined : v }]);

	// ---- resetting, with UNDO ------------------------------------------------------------------
	/** What a RESET just moved, on the section (RESET SECTION) or on its row. Gone when the page is left. */
	let band = $state<{ at: string; a: string; b: string; undo: { id: ValueId; v: Json }[] } | null>(
		null
	);
	function reset(rows: RowDef[], at: string, a: string) {
		const moves = resetMoves(rows, values);
		if (!moves.length) return;
		const undo = moves.map((m) => ({ id: m.id, v: values[m.id] as Json }));
		band = { at, a, b: movesLine(moves), undo };
		void setValues(moves.map((m) => ({ id: m.id, v: undefined })));
	}
	function undo() {
		if (!band) return;
		const u = band.undo;
		band = null;
		void setValues(u);
	}

	// ---- lists behind N SERIES DIFFER → (2A) ---------------------------------------------------
	let open = $state<string | null>(null);
	type Item = { href: string; t: string; v: string; ids: number[] };
	function itemsOf(row: RowDef): { what: string; items: Item[] } | null {
		const href = (id: number) => resolve('/series/[id]', { id: String(id) });
		if (row.overrides === 'audio' || row.overrides === 'subs') {
			const what = row.overrides;
			return {
				what,
				items: data.lists[what].map((o) => ({
					href: href(o.seriesId),
					t: o.title,
					v: overrideLine(what, o.value, o.chosenAt),
					ids: [o.seriesId]
				}))
			};
		}
		if (row.overrides === 'mode') {
			const novel = row.id === 'layout';
			return {
				what: 'mode',
				items: data.lists.mode
					.filter((o) => (o.kind === 'novel') === novel)
					.map((o) => ({
						href: href(o.seriesId),
						t: o.title,
						v: modeLine(o),
						ids: [o.seriesId]
					}))
			};
		}
		return null;
	}
	function differCount(row: RowDef): number {
		if (row.overrides === 'mode')
			return row.id === 'layout'
				? (data.counts.mode.novel ?? 0)
				: (data.counts.mode.manga ?? 0) +
						(data.counts.mode.manhwa ?? 0) +
						(data.counts.mode.doujin ?? 0);
		if (row.overrides === 'audio') return data.counts.audio;
		if (row.overrides === 'subs') return data.counts.subs;
		if (row.overrides === 'edition') return data.counts.edition;
		return 0;
	}
	async function clear(what: string, ids: number[]) {
		await act('clear', [
			['what', what],
			...ids.map((id): [string, string] => ['series', String(id)])
		]);
	}

	// ---- what a row says ------------------------------------------------------------------------
	const lastSize = $derived(data.last.subsize?.v ?? null);
	function metaOf(row: RowDef): string {
		if (row.id === 'audio')
			return audioLine((data.values['anime.audio'] as string) || undefined, data.last.audio);
		if (row.id === 'subtitles') {
			const s = data.values['anime.subs'] as string | undefined;
			return subsLine(
				{
					subs: s ? (s === 'off' ? null : s) : undefined,
					size: (data.values['anime.subsize'] as string) || undefined
				},
				{ subs: data.last.subs, size: data.last.subsize }
			);
		}
		if (row.id === 'audio-kept')
			return values['dl.audio'] === ORIGINAL_ONLY
				? 'A DOWNLOAD KEEPS THE ORIGINAL ALONE · NEW DOWNLOADS ONLY'
				: values['dl.audio']
					? 'A DOWNLOAD KEEPS THE ORIGINAL AND THESE · NEW DOWNLOADS ONLY'
					: 'A DOWNLOAD KEEPS EVERY TRACK THE SOURCE HAS · CHOOSE TO KEEP THE ORIGINAL AND A FEW';
		if (phone.current && row.id === 'mode') return '';
		return row.meta ?? '';
	}
	/** The value a segment shows pressed: the set one, else what stands in for an unset default. */
	function shown(id: ValueId): Json {
		const v = values[id];
		if (v !== undefined) return v;
		if (id === 'anime.subsize') return lastSize ?? 'M';
		return valueDef(id).def;
	}
	const needsWorkstation = (row: RowDef) => off && (row.where === 'all' || row.where === 'default');
	function scopeOf(row: RowDef): string {
		if (needsWorkstation(row))
			return `○ ${row.where === 'all' ? 'ALL DEVICES' : 'DEFAULT'} · NEEDS THE WORKSTATION`;
		return scopeLabel(row, devName);
	}
	const resetWord = (row: RowDef) => row.reset ?? 'RESET';

	// ---- the zoom cells and the novel size ----------------------------------------------------
	const zoomOf = (id: ValueId) => (typeof values[id] === 'number' ? (values[id] as number) : 1);
	const sizeDevice = $derived(
		other
			? other.kind === 'phone'
				? 'phone'
				: other.kind === 'desktop' || other.kind === 'tv'
					? 'landscape'
					: 'tablet'
			: typeof window === 'undefined'
				? 'tablet'
				: deviceOf(innerWidth, innerHeight)
	);
	const size = $derived(
		typeof values['text.size'] === 'number'
			? (values['text.size'] as number)
			: baseFontSize(sizeDevice)
	);
	const stepSize = (d: 1 | -1) =>
		set('text.size', Math.min(SIZE_MAX, Math.max(SIZE_MIN, size + d)));

	// ---- AUDIO KEPT (c160) ------------------------------------------------------------------------
	const KEPT_CHIPS = ['EN', 'ES', 'PT', 'FR', 'DE', 'IT', 'AR'];
	const kept = $derived(
		keptOf((values['dl.audio'] as string | undefined) ?? '') ?? [...KEPT_CHIPS]
	);
	function toggleKept(l: string) {
		const next = kept.includes(l) ? kept.filter((x) => x !== l) : [...kept, l];
		// Every chip kept is every track kept, the default; none is the original alone.
		const all = KEPT_CHIPS.every((c) => next.includes(c));
		void set(
			'dl.audio',
			all ? '' : next.length ? KEPT_CHIPS.filter((c) => next.includes(c)).join(',') : ORIGINAL_ONLY
		);
	}

	// ---- the section index (landscape and desktop) ----------------------------------------------
	let active = $state<SectionId>('images');
	onMount(() => {
		const io = new IntersectionObserver(
			(entries) => {
				const seen = entries.filter((e) => e.isIntersecting);
				if (seen.length) active = seen[0].target.id.slice(2) as SectionId;
			},
			{ rootMargin: '-20% 0px -70% 0px' }
		);
		for (const s of SECTIONS) {
			const el = document.getElementById(`s-${s.id}`);
			if (el) io.observe(el);
		}
		return () => io.disconnect();
	});

	const sections = $derived(SECTIONS.filter((s) => s.id !== 'browse' || data.browse));
	const titleOf = (s: SectionDef) => (phone.current && s.short ? s.short : s.title);

	// ---- CATALOGUES (Catalogue Links 1u, 1v; doc/TRACKING.md) -----------------------------------
	const count = (n: number) => n.toLocaleString('en-US');
	const DAY = 24 * 3600_000;
	function accountMeta(a: AccountView): { text: string; alert: boolean } {
		if (!a.configured)
			return { text: 'THE APP ISN’T REGISTERED · SEE DOC/SECRETS.MD', alert: false };
		if (!a.userName)
			return { text: `${count(a.linked)} LINKED · SHOWN, BUT NOTHING SENT`, alert: false };
		const head = a.service === 'anilist' ? 'MAIN LIST · READ AND WRITTEN' : 'READ AND WRITTEN';
		if (a.failed.count)
			return {
				text: `${a.failed.count} SERIES NOT SENT · ${a.failed.error ?? 'DID NOT ANSWER'}${a.failed.at ? ` · ${clock(a.failed.at)}` : ''}`,
				alert: true
			};
		// AniList's token lasts a year, with no refresh: say so a month ahead.
		if (a.service === 'anilist' && a.expiresAt && a.expiresAt - Date.now() < 30 * DAY)
			return {
				text: `${head} · SIGN-IN RUNS OUT ${new Date(a.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).toUpperCase()}`,
				alert: true
			};
		if (a.waiting) return { text: `${head} · ${a.waiting} WAITING`, alert: false };
		return {
			text: `${head} · ${a.listReadAt ? `LIST READ ${clock(a.listReadAt)}` : 'ALL SENT'}`,
			alert: false
		};
	}
	const rb = $derived(data.catalogues.ranobe);
	const rbSend = $derived.by((): { text: string; alert: boolean } => {
		if (rb.failed.count)
			return {
				text: `${rb.failed.count} UNIT${rb.failed.count === 1 ? '' : 'S'} NOT SENT · ${rb.failed.error ?? 'RANOBE DID NOT ANSWER'}${rb.failed.at ? ` · ${clock(rb.failed.at)}` : ''}`,
				alert: true
			};
		return {
			text: `NOVELS · READ AND WRITTEN · ${rb.lastSent ? `LAST SENT ${clock(rb.lastSent)}` : 'NOTHING SENT YET'}`,
			alert: false
		};
	});
	const rbPassHead = $derived(
		`${rb.passAt ? `LAST PASS ${clock(rb.passAt)}` : 'NO PASS YET'} · ${count(rb.linked)} LINKED`
	);
	const signinBand = $derived.by(() => {
		const s = data.signin;
		if (!s) return null;
		const name = SERVICE_NAME[s.service as Service] ?? s.service.toUpperCase();
		if (s.outcome === 'ok')
			return { title: `SIGNED IN TO ${name}`, detail: 'ITS LIST IS BEING READ' };
		if (s.outcome === 'refused')
			return { title: `${name} SIGN-IN CANCELLED`, detail: 'NOTHING CHANGED' };
		if (s.outcome === 'unconfigured')
			return {
				title: `${name} ISN’T SET UP`,
				detail: 'ITS APP KEYS AREN’T IN .ENV · DOC/SECRETS.MD'
			};
		return { title: `${name} SIGN-IN FAILED`, detail: 'NOTHING CHANGED · TRY AGAIN' };
	});

	// ---- DEVICES ---------------------------------------------------------------------------------
	const changedOn = (settings: Record<string, Json>) =>
		deviceChanged(deviceValues(deviceIds, settings));
	const myChanged = $derived(changedOn(local));
	const changedWord = (n: number) =>
		n ? `${n} SETTING${n === 1 ? '' : 'S'} CHANGED` : 'NOTHING CHANGED';
	const others = $derived(data.devices.filter((d) => d.id !== myId));
	async function startFromDevice(from: string) {
		if (
			await act('startFrom', [
				['device', myId],
				['from', from]
			])
		)
			await syncDevice();
		local = readAll();
	}
</script>

<svelte:head><title>Settings · tsundoku</title></svelte:head>
<!-- The DEVICES row's TV code, asked again when the owner comes back (c265). -->
<svelte:window onfocus={tvBack} />
<svelte:document onvisibilitychange={tvBack} />

<div
	class="settings"
	class:phone={phone.current}
	class:wide={wide.current}
	class:desk={desktop.current}
>
	<div class="bar">
		{#if !desktop.current}
			<a class="back" href={resolve('/')}><span class="arrow">←</span><span>LIBRARY</span></a>
		{/if}
		<h1>SETTINGS</h1>
		<div class="dev" class:ink={!!other}>
			{other ? `SHOWING: ${kindWord(other.kind)}` : devName}
		</div>
	</div>

	<!-- The way back to GET STARTED, while step 04's trip lasts (doc/ONBOARDING.md). -->
	<StartTrail start={data.start} />

	{#if signinBand}<Band title={signinBand.title} detail={signinBand.detail} />{/if}

	{#if other}
		<div class="topband">
			<div class="tb-text">
				<div class="a">SHOWING THE {kindWord(other.kind)}'S SETTINGS</div>
				<div class="b">
					CHANGES REACH IT THE NEXT TIME IT OPENS · ALL-DEVICE ROWS ARE THE SAME EVERYWHERE
				</div>
			</div>
			<button type="button" class="tb-cell" onclick={() => (showing = null)}
				>BACK TO {deviceName(myKind, true)}</button
			>
		</div>
	{:else if off}
		<div class="topband">
			<div class="tb-text">
				<div class="a">○ OFFLINE</div>
				<div class="b">
					{devName}'S ROWS STILL CHANGE, AND REACH THE WORKSTATION WHEN IT'S BACK
				</div>
			</div>
		</div>
	{/if}

	<div class="body">
		{#if wide.current}
			<nav class="index" aria-label="Sections">
				{#each sections as s (s.id)}
					{@const n = sectionChanged(s, values)}
					<a
						href="#s-{s.id}"
						class:on={active === s.id}
						aria-current={active === s.id ? 'true' : undefined}
						><span>{s.n} {s.short ?? s.title}</span><span class="n">{n ? `${n} CHANGED` : ''}</span
						></a
					>
				{/each}
			</nav>
		{/if}

		<div class="content">
			{#if !wide.current}
				<div class="legend">
					<div class="lg">
						<div class="lg-a">ALL DEVICES</div>
						<div class="lg-b">KEPT ON THE WORKSTATION · ONE VALUE EVERYWHERE</div>
					</div>
					<div class="lg">
						<div class="lg-a">{devName}</div>
						<div class="lg-b">KEPT FOR THIS DEVICE · OTHERS KEEP THEIR OWN</div>
					</div>
					<div class="lg">
						<div class="lg-a">DEFAULT</div>
						<div class="lg-b">WHERE THINGS START · A SERIES CAN DIFFER</div>
					</div>
				</div>
			{/if}

			{#each sections as s (s.id)}
				{@const n = sectionChanged(s, values)}
				<section id="s-{s.id}" aria-label="{s.n} — {titleOf(s)}">
					<div class="sec-head">
						<h2>{s.n} — {titleOf(s)}</h2>
						<span class="sec-right">
							{#if s.id === 'library'}<span>{count(data.folded)} FOLDED</span>
							{:else if s.id === 'catalogues'}<span
									>{off
										? '○ OFFLINE · SIGN-INS NEED THE WORKSTATION'
										: `${count(data.catalogues.linked)} LINKED · ${data.catalogues.toReview} TO REVIEW`}</span
								>
							{:else if s.id === 'browse' && data.browse}<span
									>{data.browse.chosen.map((l) => l.toUpperCase()).join(', ')}</span
								>
							{:else if s.id === 'devices'}<span>{data.devices.length} KEPT</span>
							{:else if n}<span>{n} CHANGED ·</span><button
									type="button"
									class="link"
									onclick={() =>
										reset(s.rows, s.id, `SECTION RESET · ${n} SETTING${n === 1 ? '' : 'S'}`)}
									>{phone.current ? 'RESET' : 'RESET SECTION'}</button
								>{/if}
						</span>
					</div>
					{#if band && band.at === s.id}
						{@render resetBand()}
					{/if}
					<div class="rows">
						{#each s.rows as row (row.id)}
							{#if row.control.type === 'account'}
								{@render account(row)}
							{:else if s.id === 'browse'}
								{@render browseRow(row)}
							{:else}
								{@render settingRow(row)}
							{/if}
							{#if band && band.at === row.id}
								{@render resetBand()}
							{/if}
						{/each}
						{#if s.id === 'library'}
							{@render report()}
						{/if}
						{#if s.id === 'devices'}
							{#if wf}
								{@render wifiRow(wf)}
							{:else if data.tvHere}
								{@render tvRow(tv)}
							{/if}
							{@render devices()}
							{#if upd}
								{@render updates(upd)}
							{/if}
							{#if appUpdater.state}
								{@render thisApp(appUpdater.state)}
							{/if}
							{#if data.signIn}
								{@render signIn(data.signIn)}
							{/if}
						{/if}
					</div>
				</section>
			{/each}
			<div class="end"></div>
		</div>
	</div>
</div>

{#snippet resetBand()}
	{#if band}
		<div class="secband" role="status">
			<div class="sb-text">
				<div class="a">{band.a}</div>
				<div class="b">{band.b}</div>
			</div>
			<button type="button" class="sb-cell" onclick={undo}>UNDO</button>
		</div>
	{/if}
{/snippet}

{#snippet scope(row: RowDef)}
	{@const n = differCount(row)}
	{@const list = itemsOf(row)}
	<span class="sa" class:quiet={row.where === 'all' || needsWorkstation(row)}>{scopeOf(row)}</span>
	{#if n && !needsWorkstation(row)}
		{#if list}
			<button
				type="button"
				class="sb"
				aria-expanded={open === row.id}
				onclick={() => (open = open === row.id ? null : row.id)}
				>{differ(n, row.overrides === 'edition' ? 'BOOK' : 'SERIES')}</button
			>
		{:else}
			<span class="sb plain">{differ(n, 'BOOK').replace(' →', '')}</span>
		{/if}
	{/if}
	{#if rowChanged(row, values) && !needsWorkstation(row)}
		<button type="button" class="reset" onclick={() => reset([row], row.id, `${row.label} RESET`)}
			>{resetWord(row)}</button
		>
	{/if}
{/snippet}

{#snippet settingRow(row: RowDef)}
	{@const c = row.control}
	{@const dim = needsWorkstation(row)}
	{@const tall =
		(c.type === 'seg' && c.groups.length > 1) ||
		c.type === 'zoom' ||
		c.type === 'chips' ||
		open === row.id}
	{@const meta = metaOf(row)}
	{@const list = open === row.id ? itemsOf(row) : null}
	<div class="row" class:changed={rowChanged(row, values)} class:dim data-row={row.id}>
		<div class="label" class:tall>{row.label}</div>
		<div class="ctl">
			{#if c.type === 'seg'}
				{#each c.groups as g (g.value)}
					<div class="seg" role="group" aria-label={g.k ?? row.label}>
						{#if g.k && !(phone.current && row.id === 'subtitles')}<div class="k">{g.k}</div>{/if}
						{#each g.opts as o (JSON.stringify(o.value))}
							{@const on = equal(shown(g.value), o.value)}
							<button
								type="button"
								aria-pressed={on}
								class:on
								disabled={dim}
								onclick={() => set(g.value, o.value)}
								>{phone.current && o.short ? o.short : o.label}</button
							>
						{/each}
					</div>
				{/each}
			{:else if c.type === 'chips'}
				<div class="chips">
					<button type="button" class="on locked" aria-pressed="true" disabled
						>✓ ORIGINAL · ALWAYS</button
					>
					{#each KEPT_CHIPS as l (l)}
						{@const on = kept.includes(l)}
						<button
							type="button"
							aria-pressed={on}
							class:on
							disabled={dim}
							onclick={() => toggleKept(l)}>{on ? `✓ ${l}` : l}</button
						>
					{/each}
				</div>
			{:else if c.type === 'zoom'}
				<div class="zooms">
					{#each c.cells as z (z.value)}
						{@const v = zoomOf(z.value)}
						<div class="zoom" class:changed={isChanged(z.value, values[z.value])}>
							<div class="zh">
								<span>{z.h}</span><span class="flag"
									>{!other && inUse(z.h, phone.current) ? 'IN USE' : ''}</span
								>
							</div>
							<div class="zb">
								<button
									type="button"
									aria-label="Smaller"
									onclick={() => set(z.value, clampZoom(stepZoom(v, -1)))}>−</button
								>
								<div class="zv">{zoomLabel(v)}</div>
								<button
									type="button"
									aria-label="Larger"
									onclick={() => set(z.value, clampZoom(stepZoom(v, 1)))}>+</button
								>
							</div>
						</div>
					{/each}
				</div>
			{:else if c.type === 'step'}
				<div class="seg" role="group" aria-label={row.label}>
					<button type="button" disabled={size <= SIZE_MIN} onclick={() => stepSize(-1)}>A −</button
					>
					<button
						type="button"
						class:on={values['text.size'] !== undefined}
						aria-pressed={values['text.size'] !== undefined}>{size} PX</button
					>
					<button type="button" disabled={size >= SIZE_MAX} onclick={() => stepSize(1)}>A +</button>
				</div>
			{:else if c.type === 'info'}
				<div class="info">
					{c.value === 'speed' ? '1×' : valueLabel(c.value, values[c.value])}
				</div>
			{/if}
			{#if meta}<div class="meta">{meta}</div>{/if}
			{#if list}
				<div class="list">
					{#each list.items as it (it.href)}
						<div class="item">
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolved in itemsOf -->
							<a href={it.href}><span class="it-t">{it.t}</span><span class="it-v">{it.v}</span></a>
							<button
								type="button"
								aria-label="Back to the default"
								onclick={() => clear(list.what, it.ids)}>✕</button
							>
						</div>
					{/each}
					<div class="list-foot">
						<span
							>{differ(list.items.length).replace(' →', '')} · ✕ PUTS ONE BACK ON THE DEFAULT</span
						>
						<button
							type="button"
							class="link"
							onclick={() =>
								clear(
									list.what,
									list.items.flatMap((i) => i.ids)
								)}>CLEAR ALL {list.items.length}</button
						>
					</div>
				</div>
			{/if}
			{#if phone.current}
				<div class="scope inline">{@render scope(row)}</div>
			{/if}
		</div>
		{#if !phone.current}
			<div class="scope">{@render scope(row)}</div>
		{/if}
	</div>
{/snippet}

{#snippet account(row: RowDef)}
	{#if row.id === 'import'}
		{@const last = data.lastImport}
		{@const lastLine = last
			? `LAST: ${last.app.toUpperCase()} BACKUP · ${new Date(last.at)
					.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
					.toUpperCase()} · ${count(last.series)} SERIES`
			: 'NO IMPORT YET'}
		<!-- Import-Doors C; on a TV, D: no button, and nothing to focus. -->
		<div class="row acct import" class:dim={off}>
			<div class="label">IMPORT A BACKUP</div>
			<div class="ctl">
				<div class="acct-body">
					<div class="who">
						<div class="name">
							<span class="not-tv">Mihon, Aniyomi or LNReader</span><span class="tv-only"
								>From the computer or a phone</span
							>
						</div>
						<div class="meta">{lastLine}</div>
					</div>
					<a class="cell acc not-tv" href={resolve('/import')}>CHOOSE A FILE →</a>
				</div>
				<div class="meta not-tv">{row.meta}</div>
			</div>
			{#if !phone.current}<div class="scope">
					<span class="sa quiet">ALL DEVICES</span><a
						class="sa not-tv"
						href={resolve('/import/log')}>IMPORT LOG →</a
					>
				</div>{/if}
		</div>
	{:else if row.id === 'ranobe'}
		<div class="row acct ranobe" class:dim={off}>
			<div class="label">RANOBE</div>
			<div class="ctl">
				<div class="acct-body">
					<div class="who">
						{#if rb.configured}
							<!-- Ranobe has no endpoint naming a token's account: the mock's "Token for masshiro" can't be known (doc/RANOBE.md). -->
							<div class="name">Token in .env</div>
							<div class="meta" class:alert={rbSend.alert}>{rbSend.text}</div>
							<div class="meta">
								{rbPassHead}{#if rb.toChoose}
									· <a class="choose" href={resolve('/links')}>{rb.toChoose} TO CHOOSE</a>{/if}
								· {count(rb.notOn)} NOT ON RANOBE{rb.suggested
									? ` · ${rb.suggested} SUGGESTED`
									: ''}
							</div>
						{:else}
							<div class="name muted">Not configured</div>
							<div class="meta">NO TOKEN · RANOBE_TOKEN IN .ENV</div>
						{/if}
					</div>
					{#if rb.configured && rb.failed.count}
						<form method="POST" action="?/retryRanobe" use:enhance class="cell-form">
							<button type="submit" class="cell" disabled={off}>TRY AGAIN</button>
						</form>
					{/if}
				</div>
			</div>
			{#if !phone.current}<div class="scope"><span class="sa quiet">ALL DEVICES</span></div>{/if}
		</div>
	{:else}
		{@const a = data.catalogues.accounts.find((x) => x.service === row.id)}
		{#if a}
			{@const m = accountMeta(a)}
			<div class="row acct" class:dim={off}>
				<div class="label">{SERVICE_NAME[a.service]}</div>
				<div class="ctl">
					<div class="acct-body">
						<div class="who">
							<div class="name" class:muted={!a.userName}>
								{a.userName ? `Signed in as ${a.userName}` : 'Not signed in'}
							</div>
							<div class="meta" class:alert={m.alert}>{m.text}</div>
						</div>
						{#if a.userName}
							{#if a.failed.count}
								<form method="POST" action="?/retry" use:enhance class="cell-form">
									<input type="hidden" name="service" value={a.service} />
									<button type="submit" class="cell" disabled={off}>TRY AGAIN</button>
								</form>
							{/if}
							<form method="POST" action="?/signOut" use:enhance class="cell-form">
								<input type="hidden" name="service" value={a.service} />
								<button type="submit" class="cell" disabled={off}>SIGN OUT</button>
							</form>
						{:else if a.configured}
							{#if off}
								<span class="cell acc dim" aria-disabled="true">SIGN IN →</span>
							{:else}
								<!-- A full navigation: off to the catalogue and back (doc/TRACKING.md). -->
								<a
									class="cell acc"
									href={resolve('/settings/catalogues/[service]', { service: a.service })}
									data-sveltekit-reload>SIGN IN →</a
								>
							{/if}
						{/if}
					</div>
				</div>
				{#if !phone.current}<div class="scope"><span class="sa quiet">ALL DEVICES</span></div>{/if}
			</div>
		{/if}
	{/if}
{/snippet}

{#snippet browseRow(row: RowDef)}
	{#if data.browse}
		<div class="row" class:dim={off}>
			<div class="label tall">{row.label}</div>
			<div class="ctl">
				<form method="POST" action="?/browseLanguage" use:enhance class="chips">
					{#each data.browse.cells as l (l)}
						{@const on = data.browse.chosen.includes(l)}
						<button type="submit" name="lang" value={l} class:on aria-pressed={on} disabled={off}
							>{l.toUpperCase()}</button
						>
					{/each}
				</form>
				<div class="meta">{row.meta}</div>
				{#if phone.current}<div class="scope inline">
						<span class="sa quiet">ALL DEVICES</span>
					</div>{/if}
			</div>
			{#if !phone.current}<div class="scope"><span class="sa quiet">ALL DEVICES</span></div>{/if}
		</div>
	{/if}
{/snippet}

{#snippet updates(u: Updates)}
	{@const busy = u.install !== null && u.install.phase !== 'failed'}
	<div class="row device">
		<button
			type="button"
			class="label ask"
			aria-label="Help: updates"
			aria-expanded={helpAt?.part === 'shows'}
			onclick={() => (helpAt = { topic: 'updates', part: 'shows' })}>UPDATES<HelpMark /></button
		>
		<div class="ctl">
			<div class="acct-body">
				<div class="who">
					<div class="name">{u.current}</div>
					<div class="meta" class:alert={!!u.available || u.install?.phase === 'failed'}>
						{updateLine(u)}
					</div>
				</div>
				<button type="button" class="cell" disabled={checkingUpdates || busy} onclick={checkUpdates}
					>{checkingUpdates ? 'CHECKING' : 'CHECK'}</button
				>
				{#if u.available && u.how === 'install'}
					<button type="button" class="cell acc" disabled={busy} onclick={installUpdate}
						>UPDATE</button
					>
				{:else if u.available && u.download}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the release host, not a route -->
					<a class="cell acc" href={u.download}>DOWNLOAD</a>
				{/if}
			</div>
		</div>
		{#if !phone.current}<div class="scope">
				<span class="sa">FROM TSUNDOKU'S RELEASES</span>
			</div>{/if}
	</div>
	{#if u.available}
		<div class="pw-form">
			<div class="pw-l">WHAT'S NEW IN {u.available.version}</div>
			<p class="pw-p notes">{u.available.notes}</p>
			{#if u.how === 'install'}
				<p class="pw-p">
					UPDATE downloads it, checks it was signed by tsundoku's release key, and installs it:
					tsundoku closes for a minute and opens again. Your library stays as it is.
				</p>
			{:else}
				<p class="pw-p">
					DOWNLOAD it, unpack it beside this one, and start tsundoku from the new folder. Your
					library stays where it is; delete the old folder once the new one runs.
				</p>
			{/if}
		</div>
	{/if}
{/snippet}

{#snippet thisApp(a: AppUpdate)}
	<!-- tsundoku's Android app, which updates itself (c614; doc/UPDATES.md, "The Android apps"). -->
	{@const offer = a.phase === 'available' || a.phase === 'ready'}
	{@const retry = a.phase === 'error' && appUpdater.offer !== null}
	{@const busy = ['checking', 'downloading', 'permission', 'installing'].includes(a.phase)}
	<div class="row device">
		<div class="label">{m.update_app_row()}</div>
		<div class="ctl">
			<div class="acct-body">
				<div class="who">
					<div class="name">{a.running}</div>
					<div class="meta" class:alert={offer || a.phase === 'error'}>{appLine(a, when)}</div>
				</div>
				<button type="button" class="cell" disabled={busy} onclick={() => appUpdater.check()}
					>{a.phase === 'checking' ? 'CHECKING' : 'CHECK'}</button
				>
				{#if offer || retry}
					<button type="button" class="cell acc" onclick={() => appUpdater.start()}
						>{retry ? 'TRY AGAIN' : 'UPDATE'}</button
					>
				{/if}
			</div>
		</div>
	</div>
	{#if offer}
		<div class="pw-form">
			<div class="pw-l">WHAT'S NEW IN {a.version}</div>
			<p class="pw-p notes">{a.notes}</p>
			<p class="pw-p">{m.update_app_say()}</p>
		</div>
	{/if}
{/snippet}

{#snippet signIn(si: { kind: 'password' | 'none'; local: boolean; min: number })}
	<!-- A friend's sign-in (doc/SIGN-IN.md): the workstation signs in with its token and has no row. -->
	<div class="row device">
		<div class="label">PASSWORD</div>
		<div class="ctl">
			<div class="acct-body">
				<div class="who">
					<div class="name">{si.kind === 'password' ? 'SET' : 'NONE'}</div>
					<div class="meta" class:alert={!!form?.password}>
						{form?.password?.toUpperCase() ??
							form?.passwordDone ??
							(si.kind === 'password'
								? 'NEEDED TO SIGN IN, ON THIS COMPUTER AND ANY OTHER'
								: 'ANYONE AT THIS COMPUTER OPENS TSUNDOKU · OVER WI-FI, ONLY A CODE SIGNS IN')}
					</div>
				</div>
				<button
					type="button"
					class="cell"
					class:acc={pw === 'set'}
					aria-expanded={pw === 'set'}
					onclick={() => (pw = pw === 'set' ? null : 'set')}
					>{si.kind === 'password' ? 'CHANGE' : 'SET'}</button
				>
				{#if si.kind === 'password' && si.local}
					<button
						type="button"
						class="cell"
						class:acc={pw === 'remove'}
						aria-expanded={pw === 'remove'}
						onclick={() => (pw = pw === 'remove' ? null : 'remove')}>REMOVE</button
					>
				{/if}
			</div>
		</div>
		{#if !phone.current}<div class="scope">
				<span class="sa">KEPT ON THIS COMPUTER</span>
			</div>{/if}
	</div>
	{#if pw}
		<form
			method="POST"
			action={pw === 'set' ? '?/password' : '?/noPassword'}
			class="pw-form"
			use:enhance={() =>
				async ({ result, update }) => {
					await update();
					if (result.type === 'success') pw = null;
				}}
		>
			{#if si.kind === 'password'}
				<label class="pw-l" for="pw-current">CURRENT PASSWORD</label>
				<input
					id="pw-current"
					name="current"
					type="password"
					autocomplete="current-password"
					required
				/>
			{/if}
			{#if pw === 'set'}
				<label class="pw-l" for="pw-new">NEW PASSWORD</label>
				<input
					id="pw-new"
					name="password"
					type="password"
					autocomplete="new-password"
					minlength={si.min}
					required
				/>
				<label class="pw-l" for="pw-again">AGAIN</label>
				<input id="pw-again" name="again" type="password" autocomplete="new-password" required />
				<p class="pw-p">Every other browser signed in to tsundoku will have to sign in again.</p>
				<button type="submit" class="pw-go"
					>{si.kind === 'password' ? 'CHANGE PASSWORD' : 'SET PASSWORD'}</button
				>
			{:else}
				<p class="pw-p">
					Anyone who uses this computer will open tsundoku, and everything in it, without signing
					in. Nothing else can reach it while there's no password.
				</p>
				<input type="hidden" name="sure" value="yes" />
				<button type="submit" class="pw-go">YES, REMOVE THE PASSWORD</button>
			{/if}
		</form>
	{/if}
{/snippet}

{#snippet report()}
	<!-- SAVE A REPORT (doc/LOGS.md; c193): a file to send when something breaks, never sent by itself. -->
	<div class="row device">
		<button
			type="button"
			class="label ask"
			aria-label="Help: a report"
			aria-expanded={helpAt?.part === 'save'}
			onclick={() => (helpAt = { topic: 'report', part: 'save' })}>REPORT<HelpMark /></button
		>
		<div class="ctl">
			<div class="acct-body">
				<div class="who">
					<div class="name">For when something breaks</div>
					<div class="meta">
						LOGS AND VERSIONS IN ONE FILE TO SEND · NOTHING YOU'VE HIDDEN, NO PASSWORDS OR TOKENS ·
						NEVER SENT BY ITSELF
					</div>
				</div>
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- a download, not a route -->
				<a class="cell" href="/api/report" download>SAVE</a>
			</div>
		</div>
		{#if !phone.current}<div class="scope">
				<span class="sa">THIS COMPUTER'S LOGS</span>
			</div>{/if}
	</div>
{/snippet}

{#snippet wifiRow(w: Wifi)}
	<!-- Reading on a phone over Wi-Fi (doc/WIFI.md; Wifi.dc.html, Wifi-Phone.dc.html 3E). -->
	{#if data.viaLan}
		<div class="row wifi">
			<button
				type="button"
				class="label top ask"
				aria-label="Help: Wi-Fi"
				aria-expanded={helpAt?.part === 'wifi'}
				onclick={() => (helpAt = { topic: 'phone', part: 'wifi' })}>WI-FI<HelpMark /></button
			>
			<div class="ctl col">
				<div class="wifi-value">{w.on ? 'ON' : 'OFF'}</div>
				<div class="wifi-meta">
					SWITCHED ON THE COMPUTER, WHERE ITS CODE IS SHOWN · OVER WI-FI THIS PHONE CAN'T INSTALL
					THE APP, KEEP CHAPTERS, KEEP THE SCREEN AWAKE OR CHECK A FINGERPRINT
				</div>
			</div>
			{#if !phone.current}<div class="scope wifi-scope">
					<span class="sa">SET ON THE COMPUTER ONLY</span>
				</div>{/if}
		</div>
	{:else}
		{@const on = w.on && w.reach !== 'public'}
		{@const starting = on && !w.listening && w.reach === 'home'}
		<div class="row wifi">
			<button
				type="button"
				class="label top ask"
				aria-label="Help: Wi-Fi"
				aria-expanded={helpAt?.part === 'wifi'}
				onclick={() => (helpAt = { topic: 'phone', part: 'wifi' })}>WI-FI<HelpMark /></button
			>
			<div class="ctl col">
				<div class="wifi-seg" role="group" aria-label="Other devices on this Wi-Fi">
					<button
						type="button"
						aria-pressed={!on}
						disabled={wifiBusy}
						onclick={() => w.on && wifiPost('off')}>OFF</button
					>
					<button
						type="button"
						aria-pressed={on}
						disabled={wifiBusy || w.reach === 'public'}
						onclick={() => !w.on && wifiPost('on')}
						>{starting || (wifiBusy && !w.on) ? 'ON · STARTING…' : 'ON'}</button
					>
				</div>
				<div class="wifi-meta" class:loud={w.reach === 'public'}>{wifiMeta(w)}</div>
				{#if w.reach !== 'public'}
					<div class="wifi-strip">
						<div>
							<div class="sk">ON THE PHONE</div>
							<div class="sv">READING · BROWSING · SEARCH · DOWNLOADS · EVERY SETTING</div>
						</div>
						<div>
							<div class="sk">NOT OVER WI-FI</div>
							<div class="sv">
								INSTALLING AS AN APP · OFFLINE CHAPTERS · SCREEN KEPT AWAKE · FINGERPRINT CHECKS ·
								TAILSCALE GIVES ALL OF IT: SEE THE README
							</div>
						</div>
					</div>
				{/if}
			</div>
			{#if !phone.current}<div class="scope wifi-scope">
					<span class="sa">THIS COMPUTER</span>
					<span class="sb2">SET HERE ONLY, NEVER FROM A PHONE</span>
				</div>{/if}
		</div>
		{#if on}
			{@render pairingPanel(w, starting || (wifiBusy && !w.listening))}
		{/if}
	{/if}
{/snippet}

{#snippet tvRow(t: Tv | null)}
	<!-- The app's six digits where there is no WI-FI panel to carry them (c245;
	     doc/WIFI.md): the owner's tailnet install. The block is the pairing
	     panel's own, without the browser's QR; since c521 it is the app's, on a
	     TV, a phone or a tablet, and it writes out the whole address the app
	     types, since a tailnet install has no last-number shortcut
	     (PhoneApp-Computer.dc.html). With no code at all (a restart, until a
	     visit or the app makes one) the row is still drawn, with NEW CODE. -->
	{@const live = !!t && tvLive(t)}
	{@const mins = t ? tvMinutes(t) : 0}
	<div class="row wifi">
		<div class="label top">THE APP</div>
		<div class="ctl col">
			<div class="pair-tv">
				<div class="pk ink">FOR THE APP · SIX DIGITS</div>
				{#if t && live}
					<div class="tvcode" aria-label="Pairing code for the app">
						<span>{t.code.slice(0, 3)}</span><span>{t.code.slice(3)}</span>
					</div>
				{:else if !t}
					<div class="tvcode dim">—</div>
				{:else}
					<!-- Used, burned (the refresh reads the code as it is, c265), or
					     past its time by the server or by this page's own clock. -->
					<div class="tvcode dim">
						{t.state === 'used' ? '✓ USED' : t.state === 'burned' ? 'BURNED' : 'EXPIRED'}
					</div>
				{/if}
				<div class="pnote">
					TYPE THE WHOLE ADDRESS IN THE APP ON A TV, PHONE OR TABLET, THEN THESE SIX
				</div>
				{#if data.appOrigin}
					<div class="whole">
						<span class="pk">THE WHOLE ADDRESS</span><span class="wa">{data.appOrigin}</span>
					</div>
				{/if}
				{#if live}
					<div class="tvline ink">
						{mins > 0
							? `GOOD FOR ${mins} MIN · ONE DEVICE, ONCE`
							: 'UNDER A MINUTE LEFT · ONE DEVICE, ONCE'}
					</div>
				{:else if t?.state === 'used'}
					<div class="tvline">✓ USED · ONE DEVICE, ONCE</div>
				{:else if t?.state === 'burned'}
					<div class="tvline">NO TRIES LEFT · MAKE A NEW CODE</div>
				{:else if !t}
					<!-- No code at all, which is not an expired one (c580): the server's
					     memory after a restart, until a visit, NEW CODE or a TV makes one. -->
					<div class="tvline">NO CODE YET · MAKE A NEW CODE</div>
				{:else}
					<div class="tvline">EXPIRED · MAKE A NEW CODE</div>
				{/if}
			</div>
			<div class="pair-foot">
				<div class="pf" class:ink={live}>FIVE WRONG TRIES BURN IT</div>
				<button type="button" class="new" class:acc={!live} disabled={tvBusy} onclick={newTvCode}
					>NEW CODE</button
				>
			</div>
		</div>
		{#if !phone.current}<div class="scope wifi-scope">
				<span class="sa">THIS COMPUTER</span>
				<span class="sb2">SET HERE ONLY, NEVER FROM A PHONE</span>
			</div>{/if}
	</div>
{/snippet}

{#snippet pairingPanel(w: Wifi, starting: boolean)}
	<!-- A friend's install with WI-FI on (c188; doc/WIFI.md), rearranged around
	     one address for c521 (PhoneApp-Computer.dc.html): THIS COMPUTER'S
	     ADDRESS across the top, since both ways in start from it, then the two
	     ways side by side: FOR THE APP (the six digits, first and larger) and
	     FOR A BROWSER (the QR, for a phone without the app). -->
	{@const c = w.code}
	{@const noAddr = !starting && w.reach === 'none'}
	{@const ready = !starting && !noAddr}
	<div class="pair" aria-label="Pairing">
		{#if w.changed}
			<div class="pair-band" role="status">
				<div class="pa">THE ADDRESS CHANGED · {w.changed.from} → {w.changed.to}</div>
				<div class="pb">
					THE ROUTER GAVE THIS COMPUTER A NEW ONE · DEVICES PAIRED AT THE OLD ONE FIND NOTHING
					THERE: PAIR THEM AGAIN
				</div>
			</div>
		{/if}
		{#if w.phone && ready}
			<div class="pair-addr">
				<div class="pk">THIS COMPUTER'S ADDRESS</div>
				<div class="paddr">{w.phone.replace(/^https?:\/\//, '')}</div>
				<div class="pnote">THE APP TAKES ITS LAST NUMBER · A BROWSER TAKES ALL OF IT</div>
			</div>
		{/if}
		<div class="pair-main" class:one={!(w.tv && ready)}>
			{#if w.tv && ready}
				<!-- The digits typed in tsundoku's own app, on a TV, a phone or a
				     tablet (c236, c521; doc/TV.md, doc/PHONE-APP.md). -->
				<div class="pair-tv">
					<div class="pk ink">FOR THE APP · SIX DIGITS</div>
					{#if w.tv.state === 'live'}
						<div class="tvcode" aria-label="Pairing code for the app">
							<span>{w.tv.code.slice(0, 3)}</span><span>{w.tv.code.slice(3)}</span>
						</div>
					{:else}
						<!-- The poll reads the code as it is (c460): a burned one stays
						     BURNED until NEW CODES, as on the DEVICES row (c265). -->
						<div class="tvcode dim">
							{w.tv.state === 'used' ? '✓ USED' : w.tv.state === 'burned' ? 'BURNED' : 'EXPIRED'}
						</div>
					{/if}
					<div class="ph">Typed in tsundoku's own app, on a TV, a phone or a tablet</div>
					<div class="pnote">
						THE ADDRESS'S LAST NUMBER, THEN THESE SIX · FIVE WRONG TRIES BURN THEM
					</div>
					{#if w.tv.state === 'live'}
						<div class="tvline ink">GOOD FOR {w.tv.minutes} MIN · ONE DEVICE, ONCE</div>
					{:else if w.tv.state === 'used'}
						<div class="tvline ink">✓ USED · ONE DEVICE, ONCE</div>
					{:else if w.tv.state === 'burned'}
						<div class="tvline">NO TRIES LEFT · MAKE A NEW CODE</div>
					{:else}
						<div class="tvline">EXPIRED · MAKE A NEW CODE</div>
					{/if}
				</div>
			{/if}
			<div class="pair-code">
				{#if c && c.state === 'live' && ready}
					<div class="qr">
						<QrCode text={c.url} size={150} label="Pairing code for a phone's browser" />
					</div>
				{:else}
					<div class="qr-empty">
						<div class="ql">
							{starting
								? 'STARTING…'
								: noAddr
									? 'NO ADDRESS'
									: c?.state === 'used'
										? '✓ USED'
										: 'EXPIRED'}
						</div>
						<div class="qs">
							{starting
								? 'THE CODE APPEARS HERE'
								: noAddr
									? 'STILL LOOKING'
									: c?.state === 'used'
										? 'ONE PHONE, ONCE'
										: 'NOT SCANNED IN 10 MIN'}
						</div>
					</div>
				{/if}
				<div class="pair-text">
					{#if starting && w.firstTime}
						<div class="pk">WINDOWS WILL ASK, ONCE</div>
						<div class="ph">A Windows window opens outside the browser</div>
						<div class="pbody">
							It may open behind this one: “Windows Defender Firewall has blocked some features of
							this app”. Leave Private networks ticked and choose Allow access. It won't ask again.
						</div>
					{:else if starting}
						<div class="pk">STARTING</div>
						<div class="ph">tsundoku starts listening on the Wi-Fi</div>
						<div class="pbody">The codes appear here in a few seconds.</div>
					{:else if noAddr}
						<div class="pk">NO HOME-NETWORK ADDRESS</div>
						<div class="ph">This computer isn't on a Wi-Fi right now</div>
						<div class="pbody">
							Connect it to the Wi-Fi the phone uses, or by cable to the router. It keeps looking,
							and the codes appear here by themselves.
						</div>
					{:else if c?.state === 'used'}
						<div class="pk ink">✓ SIGNED IN · {when(c.usedAt ?? Date.now())}</div>
						<div class="ph">{c.usedBy}</div>
						<div class="pbody">
							It's in the list below. For another phone's browser, make new codes.
						</div>
					{:else if c?.state === 'expired'}
						<div class="pk">EXPIRED</div>
						<div class="ph">This code went unscanned for 10 minutes</div>
						<div class="pbody">Make new ones, then scan it with the phone within 10 minutes.</div>
					{:else}
						<div class="pk">FOR A BROWSER · THE PHONE'S CAMERA</div>
						<div class="ph">Opens tsundoku in the phone's browser, signed in</div>
						<div class="pbody">
							For a phone without the app. Typing the address in its browser opens the sign-in page
							instead{data.signIn?.kind === 'password'
								? ', where your password signs in, as here'
								: ''}.
						</div>
					{/if}
				</div>
			</div>
		</div>
		<div class="pair-foot">
			<div class="pf" class:ink={ready && c?.state === 'live' && (!w.tv || w.tv.state === 'live')}>
				{starting
					? 'A FEW SECONDS'
					: noAddr
						? 'LOOKING · CHECKED JUST NOW'
						: w.tv && w.tv.state !== 'live'
							? "THE APP'S DIGITS ARE " +
								(w.tv.state === 'used' ? 'USED' : w.tv.state === 'burned' ? 'BURNED' : 'EXPIRED') +
								' · NEW CODES MAKES BOTH AGAIN'
							: c?.state === 'used'
								? "THE BROWSER'S CODE IS USED · NEW CODES MAKES BOTH AGAIN"
								: c?.state === 'expired'
									? 'CODES LAST 10 MIN'
									: c
										? `${c.minutes > 0 ? `GOOD FOR ${c.minutes} MIN` : 'UNDER A MINUTE LEFT'} · EACH SIGNS IN ONE DEVICE, ONCE`
										: ''}
			</div>
			{#if ready}
				<button
					type="button"
					class="new"
					class:acc={c?.state !== 'live' || (!!w.tv && w.tv.state !== 'live')}
					disabled={wifiBusy}
					onclick={() => wifiPost('code')}>NEW CODES</button
				>
			{/if}
		</div>
		<div class="pair-help">{m.settings_fw_wifi()}</div>
		{#if w.firewall && ready}{@render firewallHelp(w.firewall, w.noPhoneYet)}{/if}
	</div>
{/snippet}

{#snippet firewallHelp(f: NonNullable<Wifi['firewall']>, quiet: boolean)}
	<!-- A firewall on the computer (c721; doc/WIFI.md, "A firewall on the
	     computer"): the server's platform and what its probe found, the port
	     and the home network read from the running app. A line the probe can
	     name is said with its command; otherwise the general line, with the
	     commands behind a disclosure. Opened by itself when no phone has
	     reached this computer 30 s after the code was made. -->
	{@const found = f.platform === 'linux' && f.found}
	{@const open = fwOpen || quiet}
	<div class="pair-fw" class:loud={quiet} role="group" aria-label={m.settings_fw_aria()}>
		{#if quiet}<div class="fw-quiet" role="status">{m.settings_fw_quiet()}</div>{/if}
		<div class="fw-head">
			<div class="fw-line">
				{f.platform === 'windows'
					? m.settings_fw_windows()
					: found
						? m.settings_fw_found({ name: found.toUpperCase(), port: String(f.port) })
						: m.settings_fw_general({ port: String(f.port) })}
			</div>
			{#if f.platform === 'windows' || (f.platform === 'linux' && !found)}
				<button
					type="button"
					class="fw-more"
					aria-expanded={open}
					disabled={quiet}
					onclick={() => (fwOpen = !fwOpen)}
					>{f.platform === 'windows' ? m.settings_fw_windows_ask() : m.settings_fw_commands()}
					{open ? '↑' : '↓'}</button
				>
			{/if}
		</div>
		{#if found}
			<p class="fw-body">{m.settings_fw_found_body({ subnet: f.subnet })}</p>
			<code class="fw-cmd">{f.commands[found]}</code>
		{:else if open && f.platform === 'linux'}
			<p class="fw-body">{m.settings_fw_commands_body({ subnet: f.subnet })}</p>
			<div class="fw-k">UFW</div>
			<code class="fw-cmd">{f.commands.ufw}</code>
			<div class="fw-k">FIREWALLD</div>
			<code class="fw-cmd">{f.commands.firewalld}</code>
		{:else if open && f.platform === 'windows'}
			<p class="fw-body">{m.settings_fw_windows_fix_1()}</p>
			<p class="fw-body">{m.settings_fw_windows_fix_2()}</p>
		{/if}
	</div>
{/snippet}

{#snippet devices()}
	{@const me = data.devices.find((d) => d.id === myId)}
	{#each [...(me ? [me] : []), ...others] as d (d.id)}
		{@const mine = d.id === myId}
		{@const n = mine ? myChanged : changedOn(plain(d.settings))}
		{@const shownHere = mine ? !other : other?.id === d.id}
		<div class="row device" class:dim={off}>
			<div class="label">
				{mine
					? other
						? `${deviceWord(d.kind, d.label)} · THIS`
						: 'THIS'
					: deviceWord(d.kind, d.label)}
			</div>
			<div class="ctl">
				<div class="acct-body">
					<div class="who">
						<div class="name">{d.label}</div>
						<div class="meta">
							{#if data.paired[d.id]}
								{pairedMeta(data.paired[d.id], mine, n)}
							{:else}
								{mine ? 'OPEN NOW' : `LAST OPENED ${when(d.seenAt)}`} · {changedWord(n)}
							{/if}
						</div>
					</div>
					{#if !mine && myChanged === 0 && changedOn(plain(d.settings)) > 0}
						<!-- A new device starts on the defaults; its first visit offers another's (question 1). -->
						<button type="button" class="cell" disabled={off} onclick={() => startFromDevice(d.id)}
							>START FROM</button
						>
					{/if}
					<button
						type="button"
						class="cell"
						class:acc={shownHere}
						aria-pressed={shownHere}
						disabled={off && !mine}
						onclick={() => (showing = mine ? null : d.id)}>{shownHere ? 'SHOWING' : 'SHOW'}</button
					>
					{#if data.paired[d.id] && !mine && !data.viaLan}
						<!-- A lost phone (doc/WIFI.md): at once, no confirm; a new code brings it back. -->
						<form method="POST" action="?/signOutDevice" use:enhance class="cell-form">
							<input type="hidden" name="id" value={d.id} />
							<button type="submit" class="cell" disabled={off}>SIGN OUT</button>
						</form>
					{/if}
				</div>
			</div>
			{#if !phone.current}<div class="scope">
					<span class="sa">KEPT ON THE WORKSTATION</span>
				</div>{/if}
		</div>
	{/each}
{/snippet}

{#if helpAt}
	<HelpSheet open onclose={() => (helpAt = null)} topic={helpAt.topic} part={helpAt.part} />
{/if}

<style>
	/*
	 * The handoff's measurements, transcribed (Settings.dc.html): hand-set, not
	 * a spacing scale, as everywhere in tsundoku. tests/settings-frame.e2e.ts
	 * pins them so a tidy-up can't round them away.
	 */
	.settings {
		--pad: 24px;
		--label-w: 132px;
		--k-w: 84px;
		--seg-fs: 14px;
		--scope-w: 168px;
		--bar-h: 72px;
		display: flex;
		flex-direction: column;
		min-height: 100dvh;
		background: var(--surface-page);
		color: var(--text-1);
	}
	.settings.phone {
		--pad: 16px;
		--label-w: 84px;
		--k-w: 70px;
		--seg-fs: 13px;
		--bar-h: 60px;
	}
	.settings.desk {
		--bar-h: 64px;
		--scope-w: 176px;
	}
	button {
		font: inherit;
		color: inherit;
		background: none;
		border: 0;
		padding: 0;
		border-radius: 0;
		cursor: pointer;
	}
	button:disabled {
		cursor: default;
	}

	/* ---- the bar ---- */
	.bar {
		flex-shrink: 0;
		display: flex;
		align-items: stretch;
		height: var(--bar-h);
		border-bottom: var(--hairline);
	}
	.back {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 0 var(--pad);
		border-right: var(--hairline);
		color: var(--text-1);
		text-decoration: none;
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.back .arrow {
		font-size: 17px;
	}
	h1 {
		flex: 1;
		margin: 0;
		display: flex;
		align-items: center;
		padding: 0 18px;
		font: 500 13px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.dev {
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		border-left: var(--hairline);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
		color: var(--text-2);
	}
	.dev.ink {
		color: var(--text-1);
	}

	/* ---- the bands under the bar ---- */
	.topband {
		flex-shrink: 0;
		display: flex;
		align-items: stretch;
		min-height: 60px;
		border-bottom: var(--hairline);
		background: var(--surface-panel);
	}
	.tb-text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 4px;
		padding: 10px var(--pad);
	}
	.topband .a,
	.secband .a {
		font: 500 14px var(--font-mono);
	}
	.topband .b {
		font: 400 13px/1.4 var(--font-mono);
		color: var(--text-2);
	}
	.tb-cell {
		display: flex;
		align-items: center;
		padding: 0 20px;
		border-left: var(--hairline);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
		white-space: nowrap;
	}

	/* ---- index and content ---- */
	.body {
		flex: 1;
		min-height: 0;
		display: flex;
	}
	/* The index is sticky and only as tall as its entries, so the rule between it
	   and the rows is the content's: it runs the page's length (2026-10-29). */
	.index {
		width: 260px;
		flex-shrink: 0;
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		position: sticky;
		top: 0;
		align-self: flex-start;
	}
	.desk .index {
		width: 232px;
	}
	.index a {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
		min-height: 52px;
		padding: 0 20px;
		border-bottom: var(--hairline);
		color: var(--text-1);
		text-decoration: none;
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.index a .n {
		white-space: nowrap;
		font-weight: 400;
		color: var(--text-2);
	}
	.index a.on {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.index a.on .n {
		color: var(--text-inverse);
	}
	.content {
		flex: 1;
		min-width: 0;
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		width: 100%;
	}
	/* The rows stop at 880px; the column closes there, or their rules run out into nothing. */
	.wide .content {
		border-left: var(--hairline);
	}
	.desk .content {
		max-width: 880px;
		border-right: var(--hairline);
	}
	.legend {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		border-bottom: var(--hairline);
		background: var(--surface-panel);
	}
	.phone .legend {
		grid-template-columns: repeat(1, minmax(0, 1fr));
	}
	.lg {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 12px var(--pad);
		border-right: var(--hairline);
	}
	.phone .lg {
		border-bottom: var(--hairline);
	}
	.lg-a {
		font: 500 12px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.lg-b {
		font: 400 12px/1.4 var(--font-mono);
		color: var(--text-2);
	}
	section {
		display: flex;
		flex-direction: column;
		scroll-margin-top: 0;
	}
	.sec-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 12px;
		padding: 24px var(--pad) 12px;
		font: 500 13px/1.2 var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.sec-head h2 {
		margin: 0;
		font: inherit;
	}
	.sec-right {
		display: flex;
		gap: 10px;
		white-space: nowrap;
	}
	.link {
		color: var(--text-1);
		text-decoration: underline;
		text-underline-offset: 3px;
		letter-spacing: 0.04em;
	}
	.secband {
		display: flex;
		align-items: stretch;
		min-height: 56px;
		border-top: 1px solid var(--text-1);
		background: var(--surface-panel);
	}
	.sb-text {
		flex: 1;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 4px;
		padding: 8px var(--pad);
	}
	.secband .b {
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}
	.sb-cell {
		display: flex;
		align-items: center;
		padding: 0 24px;
		border-left: var(--hairline);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.rows {
		border-top: var(--hairline);
	}
	.end {
		height: 96px;
	}

	/* ---- a row ---- */
	.row {
		display: flex;
		align-items: stretch;
		min-height: 64px;
		border-bottom: var(--hairline);
	}
	.row.changed {
		box-shadow: inset 3px 0 0 var(--accent);
	}
	.label {
		display: flex;
		align-items: center;
		width: var(--label-w);
		flex-shrink: 0;
		box-sizing: border-box;
		padding-left: var(--pad);
		padding-right: 8px;
		border-right: var(--hairline);
		font: 500 12px/1.3 var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	/* A label with a "?" (doc/HELP.md): the whole cell is the button, its mark after the word. */
	button.label.ask {
		/* Where the word fills a narrow cell, the mark wraps under it (Help Calls, B). */
		flex-wrap: wrap;
		align-content: center;
		gap: 6px 8px;
		border-top: 0;
		border-bottom: 0;
		border-left: 0;
		border-radius: 0;
		background: none;
		text-align: left;
		cursor: pointer;
	}
	button.label.ask:active,
	button.label.ask[aria-expanded='true'] {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.label.tall {
		align-items: flex-start;
		padding-top: 20px;
	}
	.ctl {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.row.dim .label,
	.row.dim .ctl {
		opacity: 0.4;
	}
	.seg {
		display: flex;
		min-height: 52px;
	}
	.seg + .seg {
		border-top: var(--hairline);
	}
	.k {
		width: var(--k-w);
		flex-shrink: 0;
		display: flex;
		align-items: center;
		padding-left: 14px;
		box-sizing: border-box;
		border-right: var(--hairline);
		font: 500 12px var(--font-mono);
		letter-spacing: 0.04em;
		color: var(--text-2);
	}
	/* Equal, as drawn, until a word won't fit: FOLLOW THE PLAYER takes the room it needs. */
	.seg button {
		flex: 1 1 0;
		min-width: max-content;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0 6px;
		border-right: var(--hairline);
		font: 500 var(--seg-fs) var(--font-mono);
		white-space: nowrap;
		text-align: center;
	}
	.seg button:last-child {
		border-right: 0;
	}
	.seg button.on,
	.chips button.on {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
	}
	.chips button {
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		min-height: 52px;
		padding: 0 16px;
		border-right: var(--hairline);
		border-bottom: var(--hairline);
		font: 500 14px var(--font-mono);
		white-space: nowrap;
	}
	.chips button.locked {
		opacity: 0.6;
	}
	.zooms {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
	.zoom {
		display: flex;
		flex-direction: column;
		border-bottom: var(--hairline);
	}
	.zoom:nth-child(odd) {
		border-right: var(--hairline);
	}
	.zoom.changed {
		box-shadow: inset 3px 0 0 var(--accent);
	}
	.zh {
		display: flex;
		justify-content: space-between;
		gap: 8px;
		padding: 10px 14px;
		font: 500 12px var(--font-mono);
		letter-spacing: 0.04em;
		color: var(--text-2);
	}
	.zh .flag {
		color: var(--text-1);
	}
	/* Ruled from its label, as a row's controls are from what's said under them (asked 2026-10-29). */
	.zb {
		display: flex;
		align-items: center;
		height: 52px;
		border-top: var(--hairline);
	}
	.zb button {
		width: 52px;
		height: 52px;
		display: flex;
		align-items: center;
		justify-content: center;
		font: 500 18px var(--font-mono);
		text-align: center;
	}
	.zv {
		flex: 1;
		text-align: center;
		font: 500 16px var(--font-mono);
	}
	.info {
		display: flex;
		align-items: center;
		min-height: 52px;
		padding: 0 14px;
		font: 500 15px var(--font-mono);
	}
	.meta {
		padding: 10px 14px 12px;
		font: 400 13px/1.45 var(--font-mono);
		color: var(--text-2);
	}
	/* A rule between the controls and what's said under them (asked 2026-10-29),
	   laid over the one a zoom cell or a chip already draws, so it's never doubled. */
	.ctl > .meta {
		border-top: var(--hairline);
		margin-top: -1px;
	}
	/* With nothing under them, the controls fill the row: its 64px, not their 52px
	   and a gap (WIDE PAGES, reported 2026-10-29). */
	.ctl > .seg:last-child,
	.ctl > .info:last-child {
		flex: 1;
	}
	.list {
		display: flex;
		flex-direction: column;
		border-top: var(--hairline);
	}
	.item {
		display: flex;
		align-items: stretch;
		min-height: 56px;
		border-bottom: var(--hairline);
	}
	.item a {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 3px;
		padding: 8px 14px;
		color: var(--text-1);
		text-decoration: none;
	}
	.it-t {
		font: 500 15px var(--font-sans);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.it-v {
		font: 400 12px var(--font-mono);
		color: var(--text-2);
	}
	.item button {
		width: 56px;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		border-left: var(--hairline);
		font: 500 16px var(--font-mono);
		text-align: center;
	}
	.list-foot {
		display: flex;
		justify-content: space-between;
		align-items: center;
		min-height: 52px;
		padding: 0 14px;
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.list-foot span {
		color: var(--text-2);
		font-weight: 400;
	}

	/* ---- where it applies ---- */
	.scope {
		width: var(--scope-w);
		flex-shrink: 0;
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 8px;
		padding: 10px 14px;
		border-left: var(--hairline);
		font: 500 12px/1.3 var(--font-mono);
		letter-spacing: 0.04em;
	}
	.scope.inline {
		width: auto;
		flex-direction: row;
		justify-content: flex-start;
		flex-wrap: wrap;
		gap: 6px 12px;
		padding: 0 14px 12px;
		border-left: 0;
		font: 500 12px var(--font-mono);
	}
	.sa {
		color: var(--text-1);
	}
	.sa.quiet {
		color: var(--text-2);
	}
	.sb,
	.reset {
		color: var(--text-1);
		text-decoration: underline;
		text-underline-offset: 3px;
		text-align: left;
	}
	.sb.plain {
		text-decoration: none;
	}

	/* ---- accounts and devices ---- */
	.row.acct,
	.row.device {
		min-height: 68px;
	}
	/* Three lines, so taller than a sign-in's row (Ranobe 3a: 84px against 68px). */
	.row.acct.ranobe {
		min-height: 84px;
	}
	/* IMPORT A BACKUP (c438): the row's body above its meta line, as Import-Doors C draws it. */
	.row.acct.import .ctl {
		display: flex;
		flex-direction: column;
	}
	.row.acct.import .ctl > .meta {
		padding: 10px 14px 12px;
		border-top: var(--hairline);
	}
	.row.acct.import .scope a {
		text-decoration: none;
	}
	.tv-only {
		display: none;
	}
	/* The TV never imports (Import-Doors D): the row says so, with no button and nothing to focus. */
	@media (pointer: none) and (min-width: 900px) {
		.not-tv {
			display: none;
		}
		.tv-only {
			display: inline;
		}
	}
	.acct-body {
		flex: 1;
		display: flex;
		align-items: stretch;
	}
	.who {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 5px;
		padding: 10px 14px;
	}
	.name {
		font: 500 15px var(--font-sans);
	}
	.name.muted {
		color: var(--text-2);
	}
	.who .meta {
		padding: 0;
		font: 400 13px/1.35 var(--font-mono);
	}
	.who .meta.alert {
		color: var(--text-1);
	}
	.choose {
		color: var(--text-1);
	}
	.cell-form {
		display: flex;
	}
	.cell {
		display: flex;
		align-items: center;
		padding: 0 18px;
		border-left: var(--hairline);
		color: var(--text-1);
		text-decoration: none;
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
		white-space: nowrap;
	}
	.cell.acc {
		background: var(--accent);
		color: var(--on-accent);
	}
	.cell:disabled,
	.cell.dim {
		opacity: 0.4;
	}
	/* ---- WI-FI (Wifi.dc.html): the handoff's measurements, transcribed ---- */
	.label.top {
		align-items: flex-start;
		padding-top: 20px;
	}
	.ctl.col {
		flex-direction: column;
		align-items: stretch;
	}
	.wifi-seg {
		display: flex;
		min-height: 52px;
	}
	.wifi-seg button {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		font: 500 14px var(--font-mono);
		text-align: center;
		color: var(--text-1);
	}
	.wifi-seg button:first-child {
		border-right: 1px solid var(--line-1);
	}
	.wifi-seg button[aria-pressed='true'] {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.wifi-seg button:disabled:not([aria-pressed='true']) {
		opacity: 0.35;
	}
	.wifi-value {
		display: flex;
		align-items: center;
		min-height: 52px;
		padding: 0 14px;
		font: 500 15px var(--font-mono);
	}
	.wifi-meta {
		padding: 10px 14px 12px;
		border-top: 1px solid var(--line-1);
		font: 400 13px/1.45 var(--font-mono);
		color: var(--text-2);
	}
	.wifi-meta.loud {
		color: var(--text-1);
	}
	.wifi-strip {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		border-top: 1px solid var(--line-1);
	}
	.wifi-strip > div {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 12px 14px;
	}
	.wifi-strip > div:first-child {
		border-right: 1px solid var(--line-1);
	}
	.sk {
		font: 500 12px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.sv {
		font: 400 12px/1.45 var(--font-mono);
		color: var(--text-2);
	}
	.wifi-scope {
		flex-direction: column;
		justify-content: center;
		align-items: flex-start;
		gap: 8px;
	}
	.sb2 {
		font: 500 12px/1.3 var(--font-mono);
		letter-spacing: 0.04em;
		color: var(--text-2);
	}
	.pair {
		display: flex;
		flex-direction: column;
		border-top: 1px solid var(--text-1);
		border-bottom: 1px solid var(--line-1);
		background: var(--surface-panel);
	}
	.pair-band {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 12px 24px;
		border-bottom: 1px solid var(--line-1);
		background: var(--surface-page);
	}
	.pa {
		font: 500 14px var(--font-mono);
	}
	.pb {
		font: 400 13px/1.4 var(--font-mono);
		color: var(--text-2);
	}
	/*
	 * The two ways in, side by side (c521; PhoneApp-Computer.dc.html): the
	 * app's digits, then the browser's QR. One column when there are no digits
	 * to show (starting, no address, a panel with no TV code yet).
	 */
	.pair-main {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1px;
		background: var(--line-1);
	}
	.pair-main.one {
		grid-template-columns: minmax(0, 1fr);
	}
	.pair-code {
		display: flex;
		gap: 20px;
		padding: 22px 24px;
		background: var(--surface-panel);
	}
	/* Dark on light, so a camera reads it off a monitor. */
	.qr {
		flex-shrink: 0;
		width: 182px;
		height: 182px;
		box-sizing: border-box;
		padding: 16px;
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.qr :global(svg) {
		display: block;
	}
	.qr-empty {
		flex-shrink: 0;
		width: 182px;
		height: 182px;
		box-sizing: border-box;
		border: 1px dashed var(--line-2);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 8px;
	}
	.ql {
		font: 500 15px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.qs {
		font: 400 12px var(--font-mono);
		color: var(--text-2);
	}
	.pair-text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.pk {
		font: 500 12px/1.3 var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.pk.ink {
		color: var(--text-1);
	}
	.ph {
		font: 500 17px/1.35 var(--font-sans);
	}
	.pbody {
		font: 400 14px/1.5 var(--font-sans);
		color: var(--text-2);
		text-wrap: pretty;
	}
	/* THIS COMPUTER'S ADDRESS: the one line both ways in start from. */
	.pair-addr {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 8px 24px;
		padding: 16px 24px;
		border-bottom: 1px solid var(--line-1);
	}
	.pair-addr .pk {
		width: 150px;
		flex-shrink: 0;
	}
	.paddr {
		font: 500 22px var(--font-mono);
		letter-spacing: 0.01em;
	}
	.pair-addr .pnote {
		margin-left: auto;
		text-align: right;
	}
	.pnote {
		font: 400 13px/1.45 var(--font-mono);
		color: var(--text-2);
	}
	/* The app's six digits (c236, c521): first and larger than the QR. */
	.pair-tv {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 22px 24px;
		background: var(--surface-panel);
	}
	/* The tailnet row's block sits in the row's own column. */
	.row .pair-tv {
		padding: 20px 14px;
		background: none;
	}
	.tvcode {
		display: flex;
		gap: 18px;
		font: 500 48px/1.1 var(--font-mono);
		letter-spacing: 0.08em;
	}
	.tvcode.dim {
		color: var(--text-2);
		letter-spacing: 0.04em;
	}
	.tvline {
		font: 400 13px/1.45 var(--font-mono);
		color: var(--text-2);
	}
	.tvline.ink {
		color: var(--text-1);
	}
	.whole {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 4px 12px;
	}
	.wa {
		font: 500 16px var(--font-mono);
		overflow-wrap: anywhere;
	}
	.pair-foot {
		display: flex;
		align-items: stretch;
		min-height: 52px;
		border-top: 1px solid var(--line-1);
	}
	.pf {
		flex: 1;
		display: flex;
		align-items: center;
		padding: 0 24px;
		font: 500 12px var(--font-mono);
		letter-spacing: 0.04em;
		color: var(--text-2);
	}
	.row .pf {
		padding: 0 14px;
	}
	.pf.ink {
		color: var(--text-1);
	}
	.new {
		display: flex;
		align-items: center;
		padding: 0 24px;
		border-left: 1px solid var(--line-1);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
		white-space: nowrap;
		color: var(--text-1);
	}
	.row .new {
		padding: 0 20px;
	}
	.new.acc {
		background: var(--accent);
		color: var(--on-accent);
	}
	.pair-help {
		padding: 10px 24px 12px;
		border-top: 1px solid var(--line-1);
		font: 400 12px/1.45 var(--font-mono);
		color: var(--text-2);
	}
	/* The firewall's line (c721), in the help line's own idiom; loud when no
	   phone has reached this computer, as WI-FI's meta is for a public address. */
	.pair-fw {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 10px 24px 12px;
		border-top: 1px solid var(--line-1);
		font: 400 12px/1.45 var(--font-mono);
		color: var(--text-2);
	}
	.pair-fw.loud {
		color: var(--text-1);
	}
	.fw-quiet {
		font: 500 12px var(--font-mono);
		letter-spacing: 0.04em;
		color: var(--accent);
	}
	.fw-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 16px;
	}
	.fw-more {
		flex: none;
		padding: 0;
		border: 0;
		background: none;
		color: var(--text-1);
		font: 500 12px var(--font-mono);
		letter-spacing: 0.04em;
		cursor: pointer;
	}
	.fw-more:disabled {
		cursor: default;
	}
	.fw-body {
		margin: 0;
		max-width: 680px;
		font: 400 13px/1.5 var(--font-sans);
		color: var(--text-1);
	}
	.fw-k {
		font: 500 11px var(--font-mono);
		letter-spacing: 0.06em;
	}
	.fw-cmd {
		display: block;
		padding: 8px 12px;
		border: 1px solid var(--line-1);
		background: var(--surface-page);
		color: var(--text-1);
		font: 400 12px/1.5 var(--font-mono);
		overflow-wrap: anywhere;
		user-select: all;
	}
	/* A phone shows SETTINGS too: the two ways stack, the address line wraps. */
	.settings.phone .pair-main {
		grid-template-columns: minmax(0, 1fr);
	}
	.settings.phone .pair-code {
		flex-direction: column;
	}
	.settings.phone .pair-addr .pnote {
		margin-left: 0;
		text-align: left;
	}

	/* The PASSWORD row's form, under it: the sign-in page's fields at the row's inset. */
	.pw-form {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 10px;
		padding: 16px var(--pad) 20px calc(var(--pad) + var(--label-w));
		border-bottom: var(--hairline);
	}
	/* The rule runs the row's full width, as every row's does; the fields and text keep a measure. */
	.pw-form > * {
		max-width: 460px;
		box-sizing: border-box;
	}
	.settings.phone .pw-form {
		padding-left: var(--pad);
	}
	.pw-l {
		font: 500 12px var(--font-mono);
		color: var(--text-2);
		letter-spacing: var(--tracking-label);
	}
	.pw-form input {
		width: 100%;
		font: 500 15px var(--font-mono);
		padding: 12px 14px;
		border: 1px solid var(--line-2);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		caret-color: var(--accent);
		outline: none;
	}
	.pw-form input:focus {
		border-color: var(--text-1);
	}
	.pw-p {
		margin: 4px 0;
		font: var(--type-body);
		color: var(--text-2);
	}
	.notes {
		white-space: pre-line;
		color: var(--text-1);
	}
	.pw-go {
		padding: 12px 18px;
		background: var(--accent);
		color: var(--on-accent);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
	}
</style>
