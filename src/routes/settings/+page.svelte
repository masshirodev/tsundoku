<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import TopBar from '$lib/components/chrome/TopBar.svelte';
	import Band from '$lib/components/chrome/Band.svelte';
	import { offline } from '$lib/offline.svelte';
	import { SERVICE_NAME, clock, type Service } from '$lib/library/tracking';
	import type { AccountView } from '$lib/server/tracking';

	/**
	 * SETTINGS (Editions 1e; doc/SETTINGS.md): what the library does on every
	 * device. Its first section is the language a folded book opens in.
	 */
	let { data } = $props();

	// ---- CATALOGUES (Catalogue Links 1u, 1v; doc/TRACKING.md) -------------------------------
	const off = $derived(!offline.online);
	const count = (n: number) => n.toLocaleString('en-US');
	const DAY = 24 * 3600_000;
	function meta(a: AccountView): { text: string; alert: boolean } {
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
	const anyFailed = $derived(data.catalogues.accounts.some((a) => a.failed.count > 0));

	// ---- RANOBE (Ranobe 3a–3c; doc/RANOBE.md) ---------------------------------------------------
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
	/** The pass's line (3c). TO CHOOSE, between these, opens /links, and is left out with nothing to choose. */
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
</script>

<svelte:head><title>Settings · tsundoku</title></svelte:head>

<div class="settings">
	<TopBar label="Settings">
		{#snippet left()}
			<a class="back" href={resolve('/')}><span class="arrow">←</span><span>LIBRARY</span></a>
		{/snippet}
		{#snippet middle()}
			<h1 class="title">SETTINGS</h1>
		{/snippet}
	</TopBar>

	{#if signinBand}<Band title={signinBand.title} detail={signinBand.detail} />{/if}

	<section aria-labelledby="langs">
		<div class="section">
			<h2 id="langs">01 — BOOKS IN SEVERAL LANGUAGES</h2>
			<span>{data.folded} FOLDED</span>
		</div>
		<form method="POST" action="?/language" use:enhance class="row">
			<div class="label">OPENS IN</div>
			<div class="seg">
				{#each data.choices as l (l)}
					<button
						type="submit"
						name="language"
						value={l}
						class:on={l === data.preferred}
						aria-pressed={l === data.preferred}>{l.toUpperCase()}</button
					>
				{/each}
			</div>
		</form>
		<div class="notes">
			<p>A FOLDED BOOK OPENS IN THIS LANGUAGE.</p>
			<p>WITHOUT AN EDITION IN IT, IT OPENS IN THE ONE LAST READ.</p>
			<p>
				A BOOK’S OWN LANGUAGE ROW OVERRIDES THIS{data.overridden > 0
					? ` · ${data.overridden} BOOK${data.overridden === 1 ? '' : 'S'} DO${data.overridden === 1 ? 'ES' : ''}`
					: ''}
			</p>
		</div>
	</section>

	<section aria-labelledby="catalogues">
		<div class="section">
			<h2 id="catalogues">02 — CATALOGUES</h2>
			<span
				>{off
					? '○ OFFLINE · SIGN-INS NEED THE WORKSTATION'
					: `${count(data.catalogues.linked)} LINKED · ${data.catalogues.toReview} TO REVIEW`}</span
			>
		</div>
		<div class="rows">
			{#each data.catalogues.accounts as a (a.service)}
				{@const m = meta(a)}
				<div class="row acct">
					<div class="label">{SERVICE_NAME[a.service]}</div>
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
			{/each}
			<div class="row acct ranobe">
				<div class="label">RANOBE</div>
				<div class="who">
					{#if rb.configured}
						<!-- Ranobe has no endpoint naming a token's account: the mock's "Token for masshiro" can't be known (doc/RANOBE.md). -->
						<div class="name">Token in .env</div>
						<div class="meta" class:alert={rbSend.alert}>{rbSend.text}</div>
						<div class="meta">
							{rbPassHead}{#if rb.toChoose}
								· <a class="choose" href={resolve('/links')}>{rb.toChoose} TO CHOOSE</a>{/if}
							· {count(rb.notOn)} NOT ON RANOBE{rb.suggested ? ` · ${rb.suggested} SUGGESTED` : ''}
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
		<div class="notes">
			<p>READING HERE MOVES PROGRESS FORWARD ON BOTH. A LOWER CHAPTER IS NEVER SENT.</p>
			<p>INCOGNITO READING AND HIDDEN SERIES SEND NOTHING.</p>
			{#if anyFailed}
				<p>
					WHAT WASN'T SENT IS SENT AGAIN WITH THE NEXT CHAPTER READ, OR NOW WITH TRY AGAIN. ONLY THE
					FURTHEST CHAPTER GOES.
				</p>
			{/if}
			<p>
				TITLES OF SERIES THAT AREN’T HIDDEN ARE SEARCHED ON ANILIST IN THE COVER PASS. HENTOID BOOKS
				NEVER ARE.
			</p>
			<p>COVERS FROM A LINK NEED NO SIGN-IN.</p>
			{#if rb.configured}
				<p>
					NOVELS GO TO RANOBE, COMICS TO ANILIST AND MAL. A SERIES IS TRACKED ON ONE SIDE, NEVER
					BOTH.
				</p>
				<p>A VOLUME IS SENT ONCE ALL OF IT IS READ. MARK UNREAD TAKES BACK WHAT WAS SENT.</p>
				<p>
					INCOGNITO READING, HIDDEN SERIES AND HENTOID BOOKS SEND NOTHING, AND ARE NEVER LOOKED UP.
				</p>
				{#if rb.failed.count}
					<p>WHAT WASN’T SENT GOES WITH THE NEXT SEND, OR NOW WITH TRY AGAIN.</p>
				{/if}
				<p>
					THE TOKEN IS RANOBE_TOKEN IN .ENV, FROM INFISICAL. THERE’S NOTHING TO SIGN IN TO HERE.
				</p>
				{#if rb.suggests}
					<p>
						SUGGESTIONS GO THROUGH RANOBE_SUGGEST_TOKEN, THE APP ACCOUNT’S, AND WAIT FOR YOU ON
						RANOBE.
					</p>
				{:else}
					<p>
						WITHOUT RANOBE_SUGGEST_TOKEN NO NOVEL IS SUGGESTED, AND A MISSING EDITION GOES THROUGH
						YOUR OWN TOKEN, APPLIED AT ONCE.
					</p>
				{/if}
			{:else}
				<p>
					NOTHING TO TAP. WITHOUT A TOKEN NOTHING IS LOOKED UP OR SENT, AND NOVELS SHOW NO RANOBE
					LINE.
				</p>
			{/if}
		</div>
	</section>

	{#if data.browse}
		<section aria-labelledby="browse">
			<div class="section">
				<h2 id="browse">03 — BROWSE</h2>
				<span>{data.browse.chosen.map((l) => l.toUpperCase()).join(', ')}</span>
			</div>
			<form method="POST" action="?/browseLanguage" use:enhance class="row">
				<div class="label">LANGUAGES</div>
				<div class="seg wrap">
					{#each data.browse.cells as l (l)}
						<button
							type="submit"
							name="lang"
							value={l}
							class:on={data.browse.chosen.includes(l)}
							aria-pressed={data.browse.chosen.includes(l)}>{l.toUpperCase()}</button
						>
					{/each}
				</div>
			</form>
			<div class="notes">
				<p>BROWSE LISTS SOURCES IN THESE, AND ANY THE LIBRARY READS FROM.</p>
				<p>AVAILABLE EXTENSIONS OPEN FILTERED TO THEM; ALL WIDENS ONE VISIT.</p>
			</div>
		</section>
	{/if}
</div>

<style>
	.settings {
		display: flex;
		flex-direction: column;
		min-height: 100dvh;
		background: var(--surface-page);
		color: var(--text-1);
		--pad: 24px;
	}
	.back {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 0 var(--pad);
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
		text-decoration: none;
	}
	.arrow {
		font-size: 17px;
	}
	.title {
		margin: 0;
		padding: 0 18px;
		font: 500 13px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.section {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 24px var(--pad) 12px;
		font: 500 13px/1.2 var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	h2 {
		margin: 0;
		font: inherit;
	}
	.row {
		display: flex;
		align-items: stretch;
		min-height: 64px;
		border-top: 1px solid var(--line-1);
		border-bottom: 1px solid var(--line-1);
	}
	.label {
		display: flex;
		align-items: center;
		width: 120px;
		flex-shrink: 0;
		padding-left: var(--pad);
		border-right: 1px solid var(--line-1);
		font: 500 12px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.seg {
		flex: 1;
		display: flex;
		min-width: 0;
	}
	.seg button {
		flex: 1;
		min-width: 0;
		border: 0;
		border-right: 1px solid var(--line-1);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		cursor: pointer;
	}
	.seg.wrap {
		flex-wrap: wrap;
	}
	.seg.wrap button {
		flex: 0 0 auto;
		min-height: 52px;
		padding: 0 16px;
		border-bottom: 1px solid var(--line-1);
	}
	.seg button:last-child {
		border-right: 0;
	}
	.seg button.on {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.seg button:active:not(.on) {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.notes {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 16px var(--pad);
		font: 400 13px/1.45 var(--font-mono);
		color: var(--text-2);
	}
	.notes p {
		margin: 0;
	}
	/* CATALOGUES (Catalogue Links 1u, 1v): the mock's literals. */
	.rows {
		border-top: 1px solid var(--line-1);
	}
	.rows .row {
		border-top: 0;
	}
	.acct {
		min-height: 68px;
	}
	/* Three lines: the send, then the pass (Ranobe 3a). */
	.acct.ranobe {
		min-height: 84px;
	}
	.choose {
		color: inherit;
		text-decoration: underline;
		text-underline-offset: 3px;
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
	.meta {
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}
	.meta.alert {
		color: var(--text-1);
	}
	.cell-form {
		display: flex;
	}
	.cell {
		display: flex;
		align-items: center;
		padding: 0 20px;
		border: 0;
		border-left: 1px solid var(--line-1);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
		white-space: nowrap;
		text-decoration: none;
		cursor: pointer;
	}
	.cell.acc {
		border-left: 0;
		background: var(--accent);
		color: var(--on-accent);
	}
	.cell:disabled,
	.cell.dim {
		opacity: 0.35;
		cursor: default;
	}
	/* The phone: four languages in a row don't fit their names; they wrap into two. */
	@media (max-width: 599px) {
		.settings {
			--pad: 16px;
		}
		.label {
			width: 96px;
		}
		.seg {
			flex-wrap: wrap;
		}
		.seg button {
			flex: 1 1 50%;
			min-height: 56px;
			font-size: 13px;
			border-bottom: 1px solid var(--line-1);
		}
	}
</style>
