<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { firstOpen, TRAIL, type StartView, type Step, type StepId } from '$lib/library/start';
	import { trail } from '$lib/start-trail.svelte';

	/**
	 * GET STARTED's four steps (doc/ONBOARDING.md; the Getting Started handoff,
	 * boards 1 and 1-Steps): on the empty library and on /start, the same list.
	 * A step that's still to do opens below its row; the first one to do opens
	 * by itself. Each ticks itself from what's really there (server/start.ts);
	 * SKIP and UNDO are kept on the computer.
	 */
	let { view, libraryRoot }: { view: StartView; libraryRoot: string } = $props();

	let opened = $state<StepId | null | undefined>(undefined);
	// The first step to do opens until the friend opens or closes one themselves.
	const open = $derived(opened === undefined ? firstOpen(view) : opened);
	const toggle = (id: StepId) => (opened = open === id ? null : id);

	let address = $state('');
	let copied = $state<string | null>(null);
	async function copy(text: string) {
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			// Over plain http (a phone over Wi-Fi) there's no clipboard: the words are there to type.
			return;
		}
		copied = text;
		setTimeout(() => (copied = copied === text ? null : copied), 1500);
	}
	const SEEK = [
		'mihon extension repository',
		'aniyomi extension repository',
		'lnreader plugin repository'
	];

	/** Where a done step's quiet link goes: the place it was done. */
	const doneLink: Record<StepId, { label: string; href: string }> = {
		repo: { label: 'EXTENSIONS →', href: '/browse/extensions?tab=repos' },
		ext: { label: 'BROWSE →', href: '/browse' },
		library: { label: 'LIBRARY →', href: '/' },
		phone: { label: 'SETTINGS →', href: '/settings#s-devices' }
	};
	/** A step's link starts the way back on the screen it opens (TRAIL). */
	const go = (id: StepId) => () => trail.begin(id);
</script>

<div class="ob-list">
	{#each view.steps as s (s.id)}
		{@const isOpen = s.state === 'todo' && open === s.id}
		<div class="step {s.state}" class:open={isOpen}>
			<div class="step-row">
				<div class="st-box">
					<div class="num">{s.state === 'done' ? '✓' : s.n}</div>
				</div>
				<div class="st-text">
					<div class="st-title">
						{s.title}{#if s.optional}<span class="opt">OPTIONAL</span>{/if}
					</div>
					<div class="st-meta">{s.meta}</div>
				</div>
				{@render acts(s, isOpen)}
			</div>
			{#if isOpen}
				<div class="st-body">{@render body(s.id)}</div>
			{/if}
		</div>
	{/each}
</div>

{#snippet acts(s: Step, isOpen: boolean)}
	{#if s.state === 'done'}
		<div class="st-acts">
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- fixed app paths -->
			<a class="quiet" href={doneLink[s.id].href}>{doneLink[s.id].label}</a>
		</div>
	{:else if s.state === 'skipped' && !s.withRepo}
		<form method="POST" action="/start?/unskip" use:enhance class="st-acts">
			<input type="hidden" name="step" value={s.id} />
			<button type="submit">UNDO</button>
		</form>
	{:else if s.state === 'todo'}
		<form method="POST" action="/start?/skip" use:enhance class="st-acts">
			<input type="hidden" name="step" value={s.id} />
			<button type="submit" class="quiet">SKIP</button>
			{#if !isOpen}<button type="button" onclick={() => toggle(s.id)}>OPEN ↓</button>{/if}
		</form>
	{/if}
{/snippet}

{#snippet body(id: StepId)}
	{#if id === 'repo'}
		<p>
			A repository is a list of extensions that someone else keeps. tsundoku doesn't name one. <b
				>Ask the friend who gave you tsundoku</b
			> for theirs, or search the web for one. Paste its address here: it says what it holds before anything
			is installed.
		</p>
		<form method="GET" action={resolve('/browse/extensions')} class="field" onsubmit={go('repo')}>
			<label class="k" for="start-repo">REPOSITORY ADDRESS</label>
			<input type="hidden" name="tab" value="repos" />
			<div class="box">
				<input
					id="start-repo"
					class="in"
					name="add"
					type="url"
					required
					placeholder="https://…/index.min.json"
					autocomplete="off"
					bind:value={address}
				/>
				<button type="submit" class="b" disabled={!address.trim()}>ASK</button>
			</div>
		</form>
		<div class="holds">
			<div>
				<span>MANGA, MANHWA, DOUJINSHI</span><span>A MIHON REPOSITORY · ENDS IN index.min.json</span
				>
			</div>
			<div><span>ANIME</span><span>AN ANIYOMI REPOSITORY · ENDS IN index.min.json</span></div>
			<div>
				<span>NOVELS</span><span>AN LNREADER PLUGIN REPOSITORY · ENDS IN plugins.min.json</span>
			</div>
		</div>
		<div class="field">
			<div class="k">TO SEARCH FOR ONE</div>
			<div class="seek">
				{#each SEEK as q (q)}
					<button type="button" class="chip" onclick={() => copy(q)}
						>{q}<span class="cp">{copied === q ? 'COPIED' : 'COPY'}</span></button
					>
				{/each}
			</div>
		</div>
	{:else if id === 'ext'}
		<p>
			An extension is one source to browse and read from: a site, in a language. Your repository
			lists them. Pick one in AVAILABLE, and it's one search away.
		</p>
		<div class="go-row">
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- a fixed app path -->
			<a class="btn primary" href={TRAIL.ext!.href} onclick={go('ext')}>AVAILABLE EXTENSIONS →</a>
			<span class="tick-note">TICKS ITSELF WHEN ONE IS INSTALLED</span>
		</div>
	{:else if id === 'library'}
		<p>
			Coming from Mihon? Put its backup in the library folder, under <b>Mihon/autobackup</b>, with
			its downloads beside it if you have them. Your own EPUBs go in the library folder too. Then
			start a scan: series appear in the library as they're found.
		</p>
		<div class="holds">
			<div><span>Mihon backup (.tachibk)</span><span>MANGA, MANHWA · Mihon/autobackup/</span></div>
			<div><span>EPUB</span><span>NOVELS · ANYWHERE IN THE FOLDER</span></div>
			<div class="later"><span>Aniyomi backup</span><span>ANIME · NOT YET</span></div>
			<div class="later"><span>LNReader backup</span><span>NOVELS · NOT YET</span></div>
		</div>
		<div class="folder">
			<div class="k">LIBRARY FOLDER</div>
			<div class="p" title={libraryRoot}>{libraryRoot}</div>
		</div>
		<form method="POST" action="/?/scan" use:enhance class="go-row">
			<button type="submit" class="btn primary lg">START SCAN</button>
			<span class="tick-note">TICKS ITSELF WHEN A SCAN FINDS A SERIES</span>
		</form>
	{:else}
		<div class="ways">
			<div class="way">
				<div class="wt">WI-FI · AT HOME</div>
				<p>
					Switch it on and scan the code with the phone's camera. The phone has to be on this same
					Wi-Fi.
				</p>
				<div class="wm2">
					READS, BROWSES, SEARCHES, DOWNLOADS<br />NO OFFLINE CHAPTERS, NO APP INSTALL
				</div>
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- a fixed app path -->
				<a class="btn primary" href={TRAIL.phone!.href} onclick={go('phone')}
					>SETTINGS › 08 — DEVICES →</a
				>
			</div>
			<div class="way">
				<div class="wt">TAILSCALE · ANYWHERE</div>
				<p>
					A free private network between your own devices. Everything works, offline chapters too.
					It needs a password and four steps.
				</p>
				<div class="wm2">THE STEPS ARE IN README.TXT, BESIDE TSUNDOKU<br />AND IN HELP</div>
				<a class="btn" href="{resolve('/help/[topic]', { topic: 'phone' })}#tailscale"
					>THE STEPS IN HELP →</a
				>
			</div>
		</div>
		<div class="tick-note">
			TICKS ITSELF WHEN A PHONE PAIRS, OR A SECOND DEVICE SIGNS IN OVER TAILSCALE
		</div>
	{/if}
{/snippet}

<style>
	/* The handoff's ob.css (.ob-list, .step*, .st-*, .field, .box, .holds,
	   .seek, .ways, .folder), transcribed; colours are tokens. */
	.ob-list {
		border-top: var(--hairline);
	}
	.step {
		border-bottom: var(--hairline);
	}
	.step-row {
		display: flex;
		align-items: stretch;
		min-height: 76px;
	}
	.st-box {
		flex-shrink: 0;
		width: 76px;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.num {
		width: 40px;
		height: 40px;
		display: flex;
		align-items: center;
		justify-content: center;
		box-sizing: border-box;
		border: 1px solid var(--line-2);
		font: 500 14px var(--font-mono);
		color: var(--text-1);
	}
	.done .num {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--on-accent);
	}
	.skipped .num {
		border-style: dashed;
		color: var(--text-2);
	}
	.open .num {
		border-color: var(--text-1);
	}
	.st-text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 6px;
		padding: 14px 16px 14px 0;
	}
	.st-title {
		font: 500 17px/1.3 var(--font-sans);
	}
	.opt {
		margin-left: 10px;
		font: 500 12px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
		vertical-align: 2px;
	}
	.st-meta {
		font: 400 13px/1.3 var(--font-mono);
		color: var(--text-2);
		text-transform: uppercase;
	}
	.skipped .st-title {
		color: var(--text-2);
	}
	.blocked .st-box,
	.blocked .st-text {
		opacity: 0.4;
	}
	.st-acts {
		display: flex;
		align-items: stretch;
	}
	.st-acts > :global(*) {
		display: flex;
		align-items: center;
		padding: 0 24px;
		border: 0;
		border-left: var(--hairline);
		border-radius: 0;
		background: none;
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		text-decoration: none;
		white-space: nowrap;
		cursor: pointer;
	}
	.st-acts > input {
		display: none;
	}
	.st-acts .quiet {
		color: var(--text-2);
	}
	.st-body {
		display: flex;
		flex-direction: column;
		gap: 22px;
		padding: 4px 32px 32px 76px;
	}
	.st-body p {
		margin: 0;
		max-width: 640px;
		font: 400 16px/1.55 var(--font-sans);
		color: var(--text-prose);
		text-wrap: pretty;
	}
	.st-body p b {
		color: var(--text-1);
		font-weight: 500;
	}
	.k {
		font: 500 12px/1.2 var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.box {
		display: flex;
		height: 52px;
		border: 1px solid var(--text-1);
	}
	.box .in {
		flex: 1;
		min-width: 0;
		padding: 0 16px;
		border: 0;
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 400 15px var(--font-mono);
		outline: none;
	}
	.box .in::placeholder {
		color: var(--text-2);
	}
	.box .b {
		display: flex;
		align-items: center;
		padding: 0 22px;
		border: 0;
		border-left: 1px solid var(--text-1);
		border-radius: 0;
		background: var(--accent);
		color: var(--on-accent);
		font: 500 14px var(--font-mono);
		cursor: pointer;
	}
	.box .b:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.holds {
		display: flex;
		flex-direction: column;
		border-top: var(--hairline);
	}
	.holds > div {
		display: flex;
		justify-content: space-between;
		gap: 16px;
		padding: 13px 0;
		border-bottom: var(--hairline);
		font: 400 14px var(--font-mono);
	}
	.holds > div > span:last-child {
		color: var(--text-2);
		text-align: right;
	}
	.holds .later {
		opacity: 0.4;
	}
	.seek {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		height: 40px;
		padding: 0 14px;
		border: 1px solid var(--line-2);
		border-radius: 0;
		background: none;
		color: var(--text-1);
		font: 400 13px var(--font-mono);
		cursor: pointer;
	}
	.chip .cp {
		color: var(--text-2);
		font-weight: 500;
		font-size: 12px;
	}
	.go-row {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 20px;
	}
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 48px;
		padding: 0 20px;
		border: 1px solid var(--line-2);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		text-decoration: none;
		white-space: nowrap;
		cursor: pointer;
	}
	.btn.primary {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--on-accent);
	}
	.btn.lg {
		height: 56px;
		padding: 0 28px;
		font-size: 15px;
		letter-spacing: 0.04em;
	}
	.tick-note {
		font: 400 12px/1.45 var(--font-mono);
		color: var(--text-2);
	}
	.ways {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1px;
		background: var(--line-1);
		border: var(--hairline);
	}
	.way {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 20px;
		background: var(--surface-page);
	}
	.way .wt {
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.way p {
		font-size: 15px;
	}
	.way .wm2 {
		font: 400 12px/1.45 var(--font-mono);
		color: var(--text-2);
	}
	.way .btn {
		align-self: flex-start;
		white-space: normal;
		text-align: center;
	}
	.folder {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.folder .p {
		padding: 14px 16px;
		border: 1px solid var(--line-2);
		font: 500 15px var(--font-mono);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	/* The phone (Start-Phone board): narrower boxes, the body under the title. */
	@media (max-width: 599px) {
		.step-row {
			min-height: 68px;
		}
		.st-box {
			width: 60px;
		}
		.num {
			width: 36px;
			height: 36px;
			font-size: 13px;
		}
		.st-title {
			font-size: 16px;
		}
		.st-meta {
			font-size: 12px;
		}
		.st-acts > :global(*) {
			padding: 0 14px;
			font-size: 13px;
		}
		.st-body {
			padding: 0 16px 24px 60px;
			gap: 16px;
		}
		.st-body p {
			font-size: 15px;
		}
		.ways {
			grid-template-columns: minmax(0, 1fr);
		}
		.holds > div {
			flex-direction: column;
			gap: 4px;
		}
		.holds > div > span:last-child {
			text-align: left;
		}
		.go-row .btn.primary {
			align-self: stretch;
		}
	}
</style>
