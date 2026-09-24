<script lang="ts">
	import { tokenize, type Token } from 'kotoba';
	import { resolve } from '$app/paths';
	import { offline } from '$lib/offline.svelte';
	import { firstWord, inflection, ordinal, posLabel, type Placement } from '$lib/japanese/panel';
	import { queueLookup, type LookupBody } from '$lib/japanese/lookups';

	/**
	 * The lookup panel (Index Japanese, 1b / 1c / 2a; doc/JAPANESE.md), shared
	 * by the image reader (a text block) and the text reader (a paragraph).
	 *
	 * The text is split into words on this device (kotoba, kuromoji), set
	 * horizontally with furigana whatever it was on the page, so the words are
	 * wide tap targets in reading order. The selected word is inverted. Its
	 * meanings come from JMdict on the workstation. Every word looked up is
	 * logged for mining, except in incognito, and on this device while
	 * offline, to send later.
	 */
	type Entry = {
		kanji: string[];
		kana: string[];
		common: boolean;
		senses: { pos: string[]; gloss: string[] }[];
	};

	let {
		text,
		context,
		placement,
		incognito,
		seriesId,
		entryId,
		place,
		start = null,
		onclose,
		onnottext,
		other = null
	}: {
		/** The block's or paragraph's text. */
		text: string;
		/** "P. 14 · BLOCK 1", "CH. 212 · ¶ 1" */
		context: string;
		placement: Placement;
		incognito: boolean;
		seriesId: number;
		entryId: number | null;
		/** Where, for the log: "P. 14", "¶ 1". */
		place: string;
		/** The character tapped, in the text reader: its word opens selected. */
		start?: number | null;
		onclose: () => void;
		/** Image reader only: the block isn't text. */
		onnottext?: () => void;
		/** A folded book: "EN P. 13 →", the same page in its other language. */
		other?: { label: string; go: () => void } | null;
	} = $props();

	let tokens = $state<Token[] | null>(null);
	let failed = $state(false);
	let selected = $state(0);
	let entries = $state<Entry[] | null>(null);
	let counts = $state<{ nth: number; session: number } | null>(null);
	let loggedHere = $state(false);

	$effect(() => {
		const t = text;
		const at = start;
		tokens = null;
		failed = false;
		tokenize(t)
			.then((tk) => {
				tokens = tk;
				selected = at === null ? firstWord(tk) : wordAt(tk, at);
			})
			.catch(() => (failed = true));
	});

	/** The word holding character `at`, or the first word. */
	function wordAt(tk: Token[], at: number): number {
		let pos = 0;
		for (let i = 0; i < tk.length; i++) {
			pos += tk[i].surface.length;
			if (at < pos) return tk[i].lookupable ? i : firstWord(tk);
		}
		return firstWord(tk);
	}

	const token = $derived(tokens?.[selected] ?? null);

	// A word selected: its meanings, and a line in the log.
	$effect(() => {
		const t = token;
		if (!t || !t.lookupable) return;
		entries = null;
		counts = null;
		loggedHere = false;
		let gone = false;
		if (offline.online) {
			const q = new URLSearchParams({
				lemma: t.lemma,
				surface: t.surface,
				...(t.reading ? { reading: t.reading } : {})
			});
			void fetch(`${resolve('/api/define')}?${q}`)
				.then((r) => (r.ok ? (r.json() as Promise<{ entries: Entry[] }>) : null))
				.then((r) => {
					if (!gone) entries = r?.entries ?? [];
				})
				.catch(() => undefined);
		}
		if (!incognito) void log(t, () => gone);
		return () => {
			gone = true;
		};
	});

	async function log(t: Token, gone: () => boolean) {
		const body: LookupBody = {
			seriesId,
			entryId,
			place,
			lemma: t.lemma,
			surface: t.surface,
			reading: t.reading,
			pos: t.pos,
			sentence: text,
			at: Date.now()
		};
		if (!offline.online) {
			queueLookup(body);
			if (!gone()) loggedHere = true;
			return;
		}
		try {
			const r = await fetch(resolve('/api/lookups'), {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			const j = r.ok ? ((await r.json()) as { nth: number; session: number }) : null;
			if (!gone() && j) counts = { nth: j.nth, session: j.session };
		} catch {
			queueLookup(body);
			if (!gone()) loggedHere = true;
		}
	}

	const head = $derived(entries?.[0] ?? null);
	const shown = $derived((entries ?? []).slice(0, 3));
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape') onclose();
	}}
/>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<section
	class="panel {placement.kind}"
	class:left={placement.kind === 'side' && placement.side === 'left'}
	aria-label="Lookup"
	onpointerdown={(e) => e.stopPropagation()}
	onpointerup={(e) => e.stopPropagation()}
	onclick={(e) => e.stopPropagation()}
>
	<div class="head">
		<span class="ctx">LOOKUP · {context}</span>
		{#if other}
			<!-- A folded book (doc/EDITIONS.md): the same page in its other language. -->
			<button type="button" class="cell" onclick={other.go}>{other.label}</button>
		{/if}
		{#if onnottext}
			<button type="button" class="cell" onclick={onnottext}>NOT TEXT</button>
		{/if}
		<button type="button" class="cell x" aria-label="Close lookup" onclick={onclose}>✕</button>
	</div>

	<div class="words" lang="ja">
		{#if tokens}
			{#each tokens as t, i (i)}
				{#if t.lookupable}
					<button
						type="button"
						class="w"
						class:on={i === selected}
						aria-pressed={i === selected}
						onclick={() => (selected = i)}
					>
						{#each t.segments as sg, k (k)}
							{#if sg.ruby}<ruby>{sg.text}<rt>{sg.ruby}</rt></ruby>{:else}<span>{sg.text}</span
								>{/if}
						{/each}
					</button>
				{:else}
					<span class="w p">{t.surface}</span>
				{/if}
			{/each}
		{:else if failed}
			<span class="note">THE WORDS DIDN’T LOAD</span>
		{:else}
			<span class="note">READING THE WORDS</span>
		{/if}
	</div>

	<div class="entry">
		{#if token && token.lookupable}
			<div class="hw">
				<span class="lemma" lang="ja">{head?.kanji[0] ?? token.lemma}</span>
				<span class="readings" lang="ja"
					>{(head?.kana ?? (token.reading ? [token.reading] : [])).join(' · ')}</span
				>
				{#if head?.common}<span class="common">COMMON</span>{/if}
			</div>
			{#if inflection(token.surface, token.lemma)}
				<div class="infl" lang="ja">{inflection(token.surface, token.lemma)}</div>
			{/if}
			{#if !offline.online}
				<div class="offline">
					<div class="ot">○ NO MEANINGS OFFLINE</div>
					<p>
						The words and readings come from this device. The meanings are in JMdict on the
						workstation, and show once it is reachable.
					</p>
				</div>
			{:else if entries && shown.length === 0}
				<div class="offline"><div class="ot">NOT IN JMDICT</div></div>
			{:else}
				{#each shown as e, n (n)}
					<div class="sense-block">
						<div class="n">{n + 1}</div>
						<div class="senses">
							<div class="pos">{posLabel(e.senses[0]?.pos ?? [])}</div>
							{#each e.senses.slice(0, 3) as s, k (k)}
								<div class="sense">
									<span class="sn">{k + 1}</span><span>{s.gloss.join('; ')}</span>
								</div>
							{/each}
						</div>
					</div>
				{/each}
			{/if}
		{/if}
	</div>

	<div class="foot" class:dashed={incognito}>
		{#if incognito}
			<span class="fl">NOT LOGGED · NO CANDIDATES</span>
			<span class="fr dashed">INCOGNITO</span>
		{:else if !offline.online || loggedHere}
			<span class="fl">LOGGED ON THIS DEVICE</span>
			<span class="fr">{offline.online ? 'TO SEND' : '○ OFFLINE'}</span>
		{:else}
			<span class="fl">LOGGED{counts ? ` · ${ordinal(counts.nth)} LOOKUP` : ''}</span>
			<span class="fr">{counts ? `${counts.session} THIS SESSION` : ''}</span>
		{/if}
	</div>
</section>

<style>
	/* Index Japanese 1b: the reader's dark controls, the mock's hand-set measures. */
	.panel {
		position: fixed;
		z-index: 35;
		display: flex;
		flex-direction: column;
		background: var(--surface-page);
		color: var(--text-1);
		user-select: none;
	}
	.bottom,
	.phone {
		left: 0;
		right: 0;
		bottom: 0;
		height: min(600px, 60dvh);
		border-top: var(--rule-strong);
	}
	.top {
		left: 0;
		right: 0;
		top: 0;
		height: min(600px, 60dvh);
		border-bottom: var(--rule-strong);
	}
	.side {
		top: 0;
		bottom: 0;
		right: 0;
		width: 420px;
		border-left: var(--rule-strong);
	}
	.side.left {
		right: auto;
		left: 0;
		border-left: 0;
		border-right: var(--rule-strong);
	}
	.head {
		display: flex;
		align-items: stretch;
		flex-shrink: 0;
		height: 56px;
		border-bottom: var(--rule-strong);
	}
	.ctx {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		padding: 0 24px;
		font: 500 13px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.cell {
		display: flex;
		align-items: center;
		padding: 0 24px;
		border: 0;
		border-left: var(--rule-strong);
		background: none;
		color: var(--text-1);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
		cursor: pointer;
	}
	.cell.x {
		font-size: 18px;
		letter-spacing: 0;
	}
	.words {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 6px 2px;
		flex-shrink: 0;
		max-height: 40%;
		overflow-y: auto;
		padding: 18px 24px 20px;
		border-bottom: var(--rule-strong);
		font:
			500 30px/1 'IBM Plex Sans JP',
			var(--font-sans);
	}
	.w {
		display: flex;
		align-items: flex-end;
		min-height: 58px;
		padding: 0 5px 6px;
		border: 0;
		border-bottom: 1px solid var(--text-1);
		background: transparent;
		color: var(--text-1);
		font: inherit;
		cursor: pointer;
	}
	.w.p {
		padding: 0 0 6px;
		color: var(--text-2);
		border-bottom-color: var(--text-2);
		cursor: default;
	}
	.w.on {
		background: var(--surface-inverse);
		color: var(--text-inverse);
		border-bottom-color: var(--text-inverse);
	}
	rt {
		padding-bottom: 3px;
		font-size: 0.46em;
		font-weight: 400;
		color: var(--text-2);
	}
	.w.on rt {
		color: var(--line-2);
	}
	.note {
		font: 500 13px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
		padding-bottom: 6px;
	}
	.entry {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
	}
	.hw {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 16px;
		padding: 20px 24px 6px;
	}
	.lemma {
		font:
			500 36px/1.1 'IBM Plex Sans JP',
			var(--font-sans);
	}
	.readings {
		flex: 1;
		font:
			400 17px 'IBM Plex Sans JP',
			var(--font-sans);
		color: var(--text-2);
	}
	.common {
		padding: 5px 8px;
		border: 1px solid var(--line-2);
		font: 500 12px var(--font-mono);
		letter-spacing: 0.06em;
	}
	.infl {
		padding: 0 24px 16px;
		font:
			400 13px var(--font-mono),
			'IBM Plex Sans JP',
			monospace;
		letter-spacing: 0.02em;
		color: var(--text-2);
	}
	.sense-block {
		display: flex;
		gap: 14px;
		padding: 16px 24px;
		border-top: var(--hairline);
	}
	.n {
		width: 18px;
		flex-shrink: 0;
		font: 500 13px/22px var(--font-mono);
		color: var(--text-2);
	}
	.senses {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.pos {
		font: 500 12px/22px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.sense {
		display: flex;
		gap: 10px;
		font: 400 18px/1.4 var(--font-sans);
	}
	.sn {
		font: 400 13px/1.8 var(--font-mono);
		color: var(--text-2);
	}
	.offline {
		padding: 16px 24px;
		border-top: var(--hairline);
	}
	.ot {
		font: 500 13px var(--font-mono);
		letter-spacing: 0.06em;
	}
	.offline p {
		margin: 10px 0 0;
		max-width: 560px;
		font: 400 16px/1.5 var(--font-sans);
		color: var(--text-2);
	}
	.foot {
		display: flex;
		align-items: stretch;
		flex-shrink: 0;
		height: 56px;
		border-top: var(--hairline);
	}
	.foot.dashed {
		border-top: 2px dashed var(--text-2);
	}
	.fl,
	.fr {
		display: flex;
		align-items: center;
		padding: 0 24px;
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.fl {
		flex: 1;
		color: var(--text-2);
	}
	.fr {
		border-left: var(--rule-strong);
	}
	.fr.dashed {
		border-left: 1px dashed var(--text-1);
	}
</style>
