<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { registerBack } from '$lib/focus';
	import Sheet from '$lib/components/chrome/Sheet.svelte';
	import { topics } from '$lib/help/topics';
	import {
		DEVICE_KEYS,
		VALUES,
		deviceChanged,
		valueDef,
		type Json,
		type ValueId
	} from '$lib/settings/catalog';
	import { deviceValues } from '$lib/settings/stamped';
	import { readLocal } from '$lib/settings/local';
	import { m } from '$lib/paraglide/messages';
	import { num, upper } from '$lib/i18n/format';
	import { getLocale } from '$lib/paraglide/runtime';

	/**
	 * MORE (Reach, tabletMore and phoneMore; doc/SETTINGS.md, "Getting there";
	 * card c171): the desktop sidebar's foot as a sheet, so the tablet's and
	 * phone's bar grows by one cell, not four.
	 */
	let {
		open,
		onclose,
		queued,
		start = null,
		lastImport = null,
		initial = 'more'
	}: {
		open: boolean;
		/**
		 * What the sheet opens on: MORE's rows, or SERVERS straight away (the
		 * library bar's server cell, S1; OK there opens S2). Read when it opens.
		 */
		initial?: 'more' | 'servers';
		onclose: () => void;
		queued: number | null;
		/** GET STARTED's count, while it isn't finished: its row comes first (doc/ONBOARDING.md). */
		start?: { done: number; total: number } | null;
		/** When the last backup came in (c438): IMPORT LOG's row says LAST 2 NOV. */
		lastImport?: number | null;
	} = $props();

	/** 2 NOV, in the device's language. */
	const day = (at: number) => {
		const d = new Date(at);
		const month = d.toLocaleDateString(getLocale(), { month: 'short' }).replace(/\.$/, '');
		// Day first, as the handoff writes it, whatever order the language prefers.
		return upper(`${d.getDate()} ${month}`);
	};

	// ---- SERVERS (c261; doc/TV-APP.md, "Servers"; doc/handoffs/tv-servers/) ----
	/*
	 * The TV app's list of servers, read from its bridge (PairingBridge.kt):
	 * MORE's last row (S6), SERVERS (S2), a server's options (S3) and FORGET
	 * (S4), all inside this one sheet, which on a TV is the 420 px panel the
	 * design draws them in. A page without the bridge (a phone, a computer, a
	 * browser on the TV) never draws any of it, and nothing is drawn until the
	 * bridge has answered, so the first paint cannot flash a row.
	 */
	type Server = {
		origin: string;
		name: string;
		tvName: string;
		shown: string;
		opened: number;
		inUse: boolean;
	};
	type Bridge = {
		servers?: () => string;
		open?: (origin: string) => void;
		probe?: (origin: string) => void;
		forgetServer?: (origin: string) => string;
		addServer?: () => void;
		renameServer?: (origin: string) => void;
		welcome?: () => void;
	};
	const bridge = (): Bridge | null =>
		typeof window === 'undefined'
			? null
			: ((window as unknown as { TsundokuTV?: Bridge }).TsundokuTV ?? null);

	/** Null: no bridge, or not asked yet. */
	let servers = $state<Server[] | null>(null);
	type View = 'more' | 'servers' | 'options' | 'forget';
	let view = $state<View>('more');
	/** The server the options and FORGET are about. */
	let chosen = $state<Server | null>(null);
	/** What each probe said: CHECKING until it answers. */
	let answers = $state<Record<string, 'checking' | 'ok' | 'no'>>({});
	/**
	 * Opened on SERVERS by the bar's cell: BACK from the list then closes the
	 * sheet, and focus goes back to the cell, rather than climbing to MORE's
	 * rows nobody asked for (TV-Servers' calls, "BACK").
	 */
	let direct = $state(false);
	/** FORGET is not pressable for its first 0.6 s, so a held OK can't fall through (S4). */
	let armed = $state(false);

	function read(): Server[] | null {
		const b = bridge();
		if (!b || typeof b.servers !== 'function') return null;
		try {
			const list = JSON.parse(b.servers()) as unknown;
			return Array.isArray(list) ? (list as Server[]) : [];
		} catch {
			return [];
		}
	}

	onMount(() => {
		servers = read();
	});

	/** SERIES TO LINK's count, from the layout (c475): its row shows while there are any. */
	const toLink = $derived(Number(page.data.toLink ?? 0));

	const inUse = $derived(servers?.find((s) => s.inUse) ?? null);
	/**
	 * Where S2's mark lands: the first one not in use, the one most likely
	 * come for; with only one server, + ADD A SERVER. Said in the markup too
	 * (`data-focus-start`), because a sheet opened on SERVERS starts its scope
	 * a frame after it opens (focusScope), after `land` has run.
	 */
	const arrival = $derived(servers?.find((s) => !s.inUse)?.origin ?? null);
	const serversLine = $derived(
		!servers
			? ''
			: servers.length <= 1
				? m.tv_servers_add_another({ n: num(servers.length) })
				: m.tv_servers_in_use_line({
						n: num(servers.length),
						name: upper(inUse?.shown ?? '')
					})
	);

	/** Focus a thing in the pane once it is drawn: each view says where the mark lands. */
	async function land(selector: string) {
		await tick();
		// The document, not the pane: MORE's own rows are not in it.
		const el = document.querySelector<HTMLElement>(`[role="dialog"] ${selector}`);
		el?.focus();
	}

	function probeAll() {
		const b = bridge();
		if (!servers || !b || typeof b.probe !== 'function') return;
		const next: Record<string, 'checking' | 'ok' | 'no'> = {};
		for (const s of servers) next[s.origin] = 'checking';
		answers = next;
		// The bridge answers on window.tsundokuProbe, as it does for the app's
		// own pages; on the library nothing else listens for it.
		(window as unknown as { tsundokuProbe?: (o: string, ok: boolean) => void }).tsundokuProbe = (
			origin,
			ok
		) => {
			if (origin in answers) answers = { ...answers, [origin]: ok ? 'ok' : 'no' };
		};
		for (const s of servers) b.probe(s.origin);
	}

	/** S2: the first one not in use has the mark; with one server, + ADD A SERVER. */
	function openServers() {
		servers = read();
		// No bridge (or an APK with no list): there is no SERVERS to open.
		if (!servers) return false;
		view = 'servers';
		probeAll();
		const other = servers.find((s) => !s.inUse);
		void land(other ? `[data-server="${CSS.escape(other.origin)}"]` : '[data-server-add]');
		return true;
	}

	function choose(s: Server) {
		if (s.inUse) {
			onclose();
			return;
		}
		bridge()?.open?.(s.origin);
	}

	function options(s: Server) {
		chosen = s;
		view = 'options';
		void land('[data-act="open"]');
	}

	let armTimer: ReturnType<typeof setTimeout> | undefined;
	function confirmForget() {
		view = 'forget';
		armed = false;
		clearTimeout(armTimer);
		armTimer = setTimeout(() => (armed = true), 600);
		void land('[data-act="keep"]');
	}

	function forget() {
		const s = chosen;
		const b = bridge();
		if (!armed || !s || !b || typeof b.forgetServer !== 'function') return;
		let left: Server[];
		try {
			left = JSON.parse(b.forgetServer(s.origin)) as Server[];
		} catch {
			left = [];
		}
		servers = left;
		if (left.length === 0) {
			// The last one: 9A, as a TV that never paired.
			b.welcome?.();
			return;
		}
		if (s.inUse) {
			// The one in use: the next that answers, else the next by when it
			// was last opened, whose 9D then offers the rest (S9).
			const next = left.find((x) => answers[x.origin] === 'ok') ?? left[0];
			b.open?.(next.origin);
			return;
		}
		chosen = null;
		view = 'servers';
		const other = left.find((x) => !x.inUse);
		void land(other ? `[data-server="${CSS.escape(other.origin)}"]` : '[data-server-add]');
	}

	/** BACK climbs the views before it closes the sheet: FORGET, options, the list, MORE. */
	function backStep(): boolean {
		if (!open || view === 'more') return false;
		if (view === 'forget') {
			view = 'options';
			void land('[data-act="forget"]');
		} else if (view === 'options') {
			const at = chosen;
			view = 'servers';
			void land(at ? `[data-server="${CSS.escape(at.origin)}"]` : '[data-server-add]');
		} else if (direct) {
			// The sheet's own Escape closes it, and its scope gives focus back to the cell.
			return false;
		} else {
			view = 'more';
			void land('[data-more-servers]');
		}
		return true;
	}
	onMount(() => registerBack(backStep));

	// A sheet that closes opens again on MORE (or on SERVERS, when its opener
	// asks), not where it was left. `pre`, so the first paint is already the
	// view asked for.
	$effect.pre(() => {
		if (!open) {
			view = 'more';
			chosen = null;
			direct = false;
			return;
		}
		untrack(() => {
			// Read on every opening: the app can rename or forget one between two
			// (RENAME is its own screen, S5), and the row's line names the one in use.
			servers = read();
			if (initial === 'servers' && view === 'more') direct = openServers();
		});
	});

	/** OPENED: TODAY, YESTERDAY, 3 DAYS AGO; NEVER for one added and not opened. */
	function openedAgo(at: number): string {
		if (!at) return m.tv_servers_opened_never();
		const days = Math.max(0, Math.floor((Date.now() - at) / 86_400_000));
		if (days === 0) return m.tv_servers_opened_today();
		if (days === 1) return m.tv_servers_opened_yesterday();
		return m.tv_servers_opened_days({ count: days, n: num(days) });
	}
	const hostOf = (origin: string) => origin.replace(/^https?:\/\//i, '');

	let changed = $state(0);
	onMount(() => {
		const store = Object.fromEntries(
			DEVICE_KEYS.flatMap((k) => {
				const v = readLocal<Json | undefined>(k, undefined);
				return v === undefined ? [] : [[k, v]];
			})
		);
		const ids = (Object.keys(VALUES) as ValueId[]).filter((id) => valueDef(id).where === 'device');
		changed = deviceChanged(deviceValues(ids, store));
	});
</script>

<Sheet {open} {onclose} label={m.more_label()}>
	{#if view === 'more'}
		<div class="head">
			<div class="title">{m.more_title()}</div>
			<button
				type="button"
				class="x"
				aria-label={m.chrome_close()}
				data-focus-mark="in"
				onclick={onclose}>✕</button
			>
		</div>
		{#if start}
			<a class="row start" data-focus-mark="in" href={resolve('/start')}
				><span>{m.name_get_started()}</span><span class="n">{start.done} / {start.total} →</span></a
			>
		{/if}
		{#if toLink > 0}
			<!-- The links review's door (c475), as in the desktop's sidebar. -->
			<a class="row" data-focus-mark="in" href={resolve('/links')}
				><span>{m.name_to_link()} →</span><span class="n">{num(toLink)}</span></a
			>
		{/if}
		<a class="row" data-focus-mark="in" href={resolve('/history')}
			><span>{m.name_history()} →</span><span class="n"></span></a
		>
		<a class="row" data-focus-mark="in" href={resolve('/downloads')}
			><span>{m.name_downloads()} →</span><span class="n"
				>{queued ? m.more_queued({ n: num(queued) }) : ''}</span
			></a
		>
		<a class="row" data-focus-mark="in" href={resolve('/settings')}
			><span>{m.name_settings()} →</span><span class="n"
				>{changed ? m.more_changed({ count: changed, n: num(changed) }) : ''}</span
			></a
		>
		<!-- HELP after SETTINGS, counting its topics (doc/HELP.md; the HELP handoff, 1D). -->
		<a class="row" data-focus-mark="in" href={resolve('/help')}
			><span>{m.name_help()} →</span><span class="n"
				>{m.more_topics({ count: topics().length, n: num(topics().length) })}</span
			></a
		>
		<!-- IMPORT LOG (c438; Import-Doors E, right): live, with when the last import came in. -->
		<a class="row" data-focus-mark="in" href={resolve('/import/log')}
			><span>{m.name_import_log()} →</span><span class="n"
				>{lastImport ? m.more_import_last({ date: day(lastImport) }) : ''}</span
			></a
		>
		{#if servers}
			<!-- S6: the TV app's last row, the only door to a second server. -->
			<button type="button" class="row" data-focus-mark="in" data-more-servers onclick={openServers}
				><span>{m.tv_servers_title()} →</span><span class="n">{serversLine}</span></button
			>
		{/if}
		<div class="foot"></div>
	{:else}
		<div class="pane">
			{#if view === 'servers' && servers}
				<!-- S2 -->
				<div class="p-head"><b>{m.tv_servers_title()}</b><span>{num(servers.length)}</span></div>
				{#each servers as s (s.origin)}
					{@const a = answers[s.origin] ?? 'checking'}
					<button
						type="button"
						class="srv"
						data-focus-mark="in"
						data-focus-start={s.origin === arrival ? '' : undefined}
						data-server={s.origin}
						onclick={() => choose(s)}
						oncontextmenu={(e) => {
							e.preventDefault();
							options(s);
						}}
					>
						<div class="g" class:acc={s.inUse} class:t2={!s.inUse && a !== 'ok'}>
							{s.inUse ? '✓' : a === 'ok' ? '●' : a === 'no' ? '○' : ''}
						</div>
						<div class="b">
							<div class="n">
								<span>{s.shown}</span><span class="st" class:acc={s.inUse}
									>{s.inUse
										? m.tv_servers_in_use()
										: a === 'ok'
											? m.tv_servers_answers()
											: a === 'no'
												? m.tv_servers_no_answer()
												: m.tv_servers_checking()}</span
								>
							</div>
							<div class="meta">{hostOf(s.origin)}</div>
						</div>
					</button>
				{/each}
				<button
					type="button"
					class="srv add"
					data-focus-mark="in"
					data-focus-start={arrival === null ? '' : undefined}
					data-server-add
					onclick={() => bridge()?.addServer?.()}
					><div class="g">+</div>
					<div class="b">{m.tv_servers_add()}</div></button
				>
				<div class="p-foot hints">
					<span><span class="key">OK</span>{m.tv_servers_hint_open()}</span>
					<span><span class="key">MENU</span>{m.tv_servers_hint_options()}</span>
					<span><span class="key">BACK</span>{m.tv_servers_hint_close()}</span>
				</div>
			{:else if view === 'options' && chosen}
				{@const a = answers[chosen.origin] ?? 'checking'}
				<!-- S3 -->
				<div class="p-head"><b>{upper(chosen.shown)}</b><span>{m.tv_servers_options()}</span></div>
				<div class="p-row">
					<div class="k">{m.tv_servers_address()}</div>
					<div class="v addr">{hostOf(chosen.origin)}</div>
				</div>
				<div class="p-row">
					<div class="k">{m.tv_servers_its_name()}</div>
					<div class="v">{chosen.name || m.tv_servers_unnamed()}</div>
				</div>
				<div class="p-row">
					<div class="k">{m.tv_servers_opened()}</div>
					<div class="v">{openedAgo(chosen.opened)}</div>
				</div>
				<div class="p-row">
					<div class="k">{m.tv_servers_now()}</div>
					<div class="v">
						{a === 'ok'
							? `● ${m.tv_servers_answers()}`
							: a === 'no'
								? `○ ${m.tv_servers_no_answer()}`
								: m.tv_servers_checking()}
					</div>
				</div>
				<button
					type="button"
					class="p-act first"
					data-focus-mark="in"
					data-act="open"
					onclick={() => chosen && choose(chosen)}>{m.tv_servers_open()} <span>→</span></button
				>
				<button
					type="button"
					class="p-act"
					data-focus-mark="in"
					data-act="rename"
					onclick={() => chosen && bridge()?.renameServer?.(chosen.origin)}
					>{m.tv_servers_rename()}</button
				>
				<button
					type="button"
					class="p-act"
					data-focus-mark="in"
					data-act="forget"
					onclick={confirmForget}>{m.tv_servers_forget()}</button
				>
				<div class="p-foot hints">
					<span><span class="key">BACK</span>{m.tv_servers_hint_list()}</span>
				</div>
			{:else if view === 'forget' && chosen}
				<!-- S4 -->
				<div class="p-head">
					<b>{m.tv_servers_forget_title({ name: upper(chosen.shown) })}</b><span></span>
				</div>
				<div class="prose">
					<p>{m.tv_servers_forget_prose({ address: hostOf(chosen.origin) })}</p>
					<div class="meta wrap">{m.tv_servers_forget_devices()}</div>
				</div>
				<button
					type="button"
					class="p-act first"
					data-focus-mark="in"
					data-act="keep"
					onclick={() => armed && backStep()}>{m.tv_servers_keep()}</button
				>
				<button
					type="button"
					class="p-act"
					data-focus-mark="in"
					data-act="confirm"
					disabled={!armed}
					onclick={forget}>{m.tv_servers_forget_name({ name: upper(chosen.shown) })}</button
				>
				<div class="p-foot hints">
					<span
						><span class="key">↓</span><span class="key">OK</span
						>{m.tv_servers_hint_forgets()}</span
					>
					<span><span class="key">BACK</span>{m.tv_servers_hint_keeps()}</span>
				</div>
			{/if}
		</div>
	{/if}
</Sheet>

<style>
	.head {
		display: flex;
		align-items: stretch;
		height: 56px;
		border-bottom: var(--hairline);
	}
	.title {
		flex: 1;
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.x {
		width: 56px;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 0;
		border-left: var(--hairline);
		background: none;
		color: var(--text-1);
		font: 500 18px var(--font-mono);
		cursor: pointer;
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		min-height: 64px;
		padding: 0 var(--pad);
		border-bottom: var(--hairline);
		color: var(--text-1);
		text-decoration: none;
		font: 500 15px var(--font-mono);
	}
	.row.start .n {
		color: var(--accent);
		font-weight: 500;
	}
	.n {
		font-weight: 400;
		color: var(--text-2);
	}
	.foot {
		height: 16px;
	}
	button.row {
		width: 100%;
		border: 0;
		border-bottom: var(--hairline);
		background: none;
		text-align: left;
		cursor: pointer;
	}

	/*
	 * SERVERS, its options and FORGET (c261): TV-Servers.dc.html's panel at its
	 * own measurements (tv.css's .p-head, .p-row, .p-act, .srv and .hints),
	 * transcribed rather than rounded: the colours are the tokens, the lengths
	 * are hand-set and pinned by tests/tv-servers.e2e.ts.
	 */
	.pane {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	.p-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: 56px;
		padding: 0 22px;
		border-bottom: var(--hairline);
		font: 500 15px/1.2 var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
		flex-shrink: 0;
	}
	.p-head b {
		font-weight: 500;
		color: var(--text-1);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.srv {
		display: flex;
		align-items: stretch;
		width: 100%;
		min-height: 72px;
		padding: 0;
		border: 0;
		border-bottom: var(--hairline);
		background: none;
		color: var(--text-1);
		text-align: left;
		font: inherit;
		cursor: pointer;
		flex-shrink: 0;
	}
	.srv > .g {
		width: 56px;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		border-right: var(--hairline);
		font: 500 18px var(--font-mono);
	}
	.srv > .b {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 4px;
		padding: 0 18px;
	}
	.srv .n {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
	}
	.srv .n > span:first-child {
		font: 500 20px/1.3 var(--font-sans);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}
	.srv .st {
		font: 500 14px/1 var(--font-mono);
		letter-spacing: 0.04em;
		white-space: nowrap;
		flex-shrink: 0;
		color: var(--text-2);
	}
	.srv .meta,
	.meta {
		font: 400 15px/1.3 var(--font-mono);
		color: var(--text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.srv.add > .b {
		font: 500 17px/1.2 var(--font-mono);
		letter-spacing: 0.02em;
	}
	.srv .st.acc,
	.g.acc {
		color: var(--accent);
	}
	.g.t2 {
		color: var(--text-2);
	}
	.p-row {
		display: flex;
		align-items: stretch;
		min-height: 56px;
		border-bottom: var(--hairline);
		flex-shrink: 0;
	}
	.p-row > .k {
		width: 116px;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		padding-left: 22px;
		border-right: var(--hairline);
		font: 500 15px/1.2 var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.p-row > .v {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 0 18px;
		font: 500 17px/1.2 var(--font-mono);
		white-space: nowrap;
		overflow: hidden;
	}
	.p-row > .v.addr {
		font: 400 15px/1.3 var(--font-mono);
		color: var(--text-1);
	}
	.p-act {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		min-height: 56px;
		padding: 0 22px;
		border: 0;
		border-bottom: var(--hairline);
		background: none;
		color: var(--text-1);
		text-align: left;
		font: 500 17px/1.2 var(--font-mono);
		letter-spacing: 0.02em;
		cursor: pointer;
		flex-shrink: 0;
	}
	.p-act:disabled {
		cursor: default;
	}
	.p-row + .p-act.first {
		margin-top: 20px;
	}
	.p-act.first {
		border-top: var(--hairline);
	}
	.prose {
		padding: 20px 22px 22px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.prose p {
		margin: 0;
		font: 400 18px/1.5 var(--font-sans);
		color: var(--text-prose);
	}
	.meta.wrap {
		white-space: normal;
		line-height: 1.5;
	}
	.p-foot {
		margin-top: auto;
		padding: 14px 22px 0;
	}
	.hints {
		display: flex;
		flex-wrap: wrap;
		gap: 10px 22px;
		font: 400 15px/1.3 var(--font-mono);
		color: var(--text-2);
		white-space: nowrap;
	}
	.key {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 26px;
		height: 24px;
		padding: 0 6px;
		margin-right: 8px;
		border: 1px solid var(--line-2);
		color: var(--text-1);
		font: 500 13px/1 var(--font-mono);
	}
</style>
