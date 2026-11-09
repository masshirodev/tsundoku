<script lang="ts">
	import Band, { clearBandUrl } from '$lib/components/chrome/Band.svelte';
	import { count } from '$lib/library/downloads';

	/**
	 * SELECT's band, under EXTENSIONS' tabs (card c696; Results board): one per
	 * press, what it set and how many, the rows it could not change marked on
	 * their own lines, and one UNDO. A later press replaces it.
	 *
	 * UNDO posts the facts it was given, so a mixed selection comes back mixed
	 * (`?/undoFlags`, doc/BANDS.md's c469 shape: whole, or not at all). REMOVE
	 * has none, because its sheet asked first; UPDATE's is BACK TO for every row
	 * it updated.
	 */
	let {
		base,
		flags = null,
		update = null,
		remove = null,
		back = null,
		selection = [],
		names = {}
	}: {
		/** EXTENSIONS' own resolved path: the actions post to it. */
		base: string;
		flags?: {
			flag: 'hidden' | 'addedHidden' | 'offHistory' | 'neverTracked';
			to: boolean;
			facts: { sourceId: string; previous: boolean }[];
			of: number;
			chg: number;
			miss: string[];
			gone: string[];
		} | null;
		update?: {
			done: string[];
			/** Each done package's version after the press: UNDO checks it is still there. */
			ver: string[];
			failed: string[];
			untrusted: string[];
			of: number;
			noUpdate: number;
		} | null;
		remove?: {
			done: string[];
			stayed: string[];
			series: number;
			queued: number;
			followed: number;
		} | null;
		back?: { done: string[] } | null;
		/** What is ticked now, so UNDO lands with the same rows ticked. */
		selection?: string[];
		/** The drawn rows' names, for a band that names one. */
		names?: Record<string, string>;
	} = $props();

	// The band's own URL parameters, said once (select.server.ts's SELECT_BAND_PARAMS).
	const PARAMS = [
		'band',
		'flag',
		'to',
		'from',
		'of',
		'chg',
		'miss',
		'gone',
		'done',
		'ver',
		'stayed',
		'untrusted',
		'series',
		'queued',
		'followed'
	] as const;
	const dismiss = () => clearBandUrl(PARAMS);
	// `encodeFacts`' shape (select.server.ts), said here so the client need not
	// import the server module; `|` is in neither kind of source id.
	/** UNDO's action, with the selection, so a no-script refusal lands still selecting. */
	const undoAction = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a throwaway copy, never read reactively
		const p = new URLSearchParams({ select: '1' });
		for (const pkg of selection) p.append('pkg', pkg);
		p.set('/undoFlags', '');
		return `${base}?${p}`;
	});
	const factsUrl = $derived(
		(flags?.facts ?? []).map((f) => `${f.sourceId}|${f.previous ? 1 : 0}`).join(',')
	);

	const FLAG_NAMES = {
		hidden: 'HIDDEN',
		addedHidden: 'ADDED HIDDEN',
		offHistory: 'OFF HISTORY',
		neverTracked: 'NEVER TRACKED'
	} as const;
	const meaning = (flag: keyof typeof FLAG_NAMES, to: boolean) => {
		if (flag === 'hidden')
			return to
				? 'THEY LEFT THE LIST AND THE SELECTION · REVEAL SHOWS THEM'
				: 'LISTED, SEARCHED AND NAMED AGAIN';
		if (flag === 'addedHidden')
			return to
				? 'A SERIES ADDED FROM THEM ARRIVES HIDDEN'
				: 'A SERIES ADDED FROM THEM ARRIVES SHOWN';
		if (flag === 'offHistory')
			return to
				? 'THEIR READS LEAVE HISTORY, AND STILL COUNT FOR PROGRESS'
				: 'THEIR READS SHOW IN HISTORY AGAIN';
		return to
			? 'NOTHING FROM THEM IS SENT TO ANILIST, MAL OR RANOBE'
			: 'THEY ARE SENT TO ANILIST, MAL AND RANOBE AGAIN';
	};

	const ext = (n: number) => `${count(n)} ${n === 1 ? 'EXTENSION' : 'EXTENSIONS'}`;
	const flagsTitle = $derived(
		flags
			? flags.flag === 'hidden' && flags.to
				? `HIDDEN · ${ext(flags.chg)}`
				: `${FLAG_NAMES[flags.flag]} · ${flags.to ? 'ON' : 'OFF'} FOR ${count(flags.chg)}${
						flags.chg === flags.of ? '' : ` OF ${count(flags.of)}`
					}`
			: ''
	);
	const flagsDetail = $derived(
		flags
			? [
					`${count(flags.facts.length)} SOURCES`,
					meaning(flags.flag, flags.to),
					flags.gone.length
						? `${count(flags.gone.length)} NOT CHANGED: NO LONGER INSTALLED · IT LEFT THE LIST AND THE SELECTION`
						: '',
					flags.miss.length ? `${count(flags.miss.length)} NOT CHANGED, MARKED BELOW` : ''
				]
					.filter(Boolean)
					.join(' · ')
			: ''
	);
	const updateTitle = $derived(
		update
			? update.done.length === update.of
				? `UPDATED · ${ext(update.done.length)}`
				: `UPDATED · ${count(update.done.length)} OF ${count(update.of)}`
			: ''
	);
	const updateDetail = $derived.by(() => {
		if (!update) return '';
		const named = (list: string[]) => list.map((p) => (names[p] ?? p).toUpperCase()).join(', ');
		const parts: string[] = [];
		if (update.failed.length)
			parts.push(
				`${named(update.failed)}: ITS REPOSITORY DIDN'T ANSWER · ITS ROW STILL OFFERS UPDATE`
			);
		if (update.untrusted.length)
			parts.push(
				`${named(update.untrusted)}: SIGNED WITH ANOTHER KEY THAN ITS REPOSITORY · NOTHING WAS INSTALLED`
			);
		// Nothing failed: say what had no update at all, and that UNDO goes back.
		if (!parts.length)
			parts.push(
				`${count(update.noUpdate)} HAD NO UPDATE · THE OLD VERSIONS ARE KEPT A WEEK · UNDO GOES BACK TO THEM`
			);
		return parts.join(' · ');
	});
	const removeTitle = $derived(remove ? `REMOVED · ${ext(remove.done.length)}` : '');
	const removeDetail = $derived(
		remove
			? [
					`${count(remove.series)} SERIES STAY · THEIR SETTINGS ARE KEPT FOR A REINSTALL`,
					remove.stayed.length
						? `${count(remove.stayed.length)} STAYED INSTALLED: OBSOLETE · NO REPOSITORY LISTS THEM, SO THEY COULD NOT BE INSTALLED AGAIN`
						: ''
				]
					.filter(Boolean)
					.join(' · ')
			: ''
	);
</script>

{#if flags}
	<Band title={flagsTitle} detail={flagsDetail} ondismiss={dismiss}>
		{#snippet action()}
			{#if flags.facts.length}
				<form method="POST" action={undoAction}>
					<input type="hidden" name="flag" value={flags.flag} />
					<input type="hidden" name="to" value={flags.to ? '1' : '0'} />
					<input type="hidden" name="from" value={factsUrl} />
					{#each selection as pkg (pkg)}<input type="hidden" name="pkg" value={pkg} />{/each}
					<button type="submit">UNDO</button>
				</form>
			{/if}
		{/snippet}
	</Band>
{:else if update}
	<Band title={updateTitle} detail={updateDetail} ondismiss={dismiss}>
		{#snippet action()}
			{#if update.done.length}
				<form method="POST" action="{base}?/undoUpdate">
					{#each update.done as pkg, i (pkg)}<input type="hidden" name="pkg" value={pkg} /><input
							type="hidden"
							name="ver"
							value={update.ver[i] ?? ''}
						/>{/each}
					<button type="submit">UNDO</button>
				</form>
			{/if}
		{/snippet}
	</Band>
{:else if remove}
	<Band title={removeTitle} detail={removeDetail} ondismiss={dismiss} />
{:else if back}
	<Band
		title={`BACK TO · ${ext(back.done.length)}`}
		detail="THE VERSION BEFORE THE UPDATE IS BACK"
		ondismiss={dismiss}
	/>
{/if}
