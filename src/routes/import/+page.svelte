<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import TopBar from '$lib/components/chrome/TopBar.svelte';
	import StartTrail from '$lib/components/start/StartTrail.svelte';
	import { refusalLines, sizeWords } from '$lib/import/backup-preview';

	/**
	 * IMPORT A BACKUP, the pick screen (c438; Import-Pick, Import-File-States
	 * A-C, Import-Phone-Pick). The file goes to the computer in pieces
	 * (doc/IMPORT.md, "The upload"); the last piece answers what it is, and a
	 * backup it reads opens its preview. Nothing is written to the library
	 * here: a file that is not a backup is refused with what it was taken for.
	 */
	let { data } = $props();

	type Pick =
		| { kind: 'idle' }
		| { kind: 'uploading'; name: string; size: number; sent: number }
		| { kind: 'reading'; name: string; size: number }
		| { kind: 'refused'; a: string; b: string };
	let pick = $state<Pick>({ kind: 'idle' });
	let input = $state<HTMLInputElement>();
	let over = $state(false);
	let token = '';
	let cancelled = false;

	/** Where the file is chosen: the log says FROM THIS DESKTOP or FROM A PHONE. */
	function origin(): 'desktop' | 'tablet' | 'phone' {
		if (matchMedia('(max-width: 599px)').matches) return 'phone';
		if (matchMedia('(min-width: 1024px) and (pointer: fine)').matches) return 'desktop';
		return 'tablet';
	}

	async function send(file: File) {
		cancelled = false;
		token = '';
		let offset = 0;
		pick = { kind: 'uploading', name: file.name, size: file.size, sent: 0 };
		const from = origin();
		for (;;) {
			const piece = file.slice(offset, offset + data.chunk);
			if (offset + piece.size >= file.size)
				pick = { kind: 'reading', name: file.name, size: file.size };
			const q = new URLSearchParams({
				name: file.name,
				size: String(file.size),
				offset: String(offset),
				from,
				token
			});
			let a:
				| { state: 'more'; token: string; written: number }
				| { state: 'read'; id: number }
				| { state: 'refused'; reason: string };
			try {
				const res = await fetch(`/import/upload?${q}`, {
					method: 'POST',
					headers: { 'content-type': 'application/octet-stream' },
					body: piece
				});
				// 403 is a refusal with its sentence (the TV's, c511); any other failure is not.
				if (!res.ok && res.status !== 403) throw new Error(String(res.status));
				a = await res.json();
			} catch {
				a = {
					state: 'refused',
					reason: `${file.name.toUpperCase()} · THE UPLOAD STOPPED · CHOOSE THE FILE AGAIN`
				};
			}
			if (cancelled) return;
			if (a.state === 'more') {
				token = a.token;
				offset = a.written;
				pick = { kind: 'uploading', name: file.name, size: file.size, sent: offset };
				continue;
			}
			if (a.state === 'read') {
				await goto(resolve('/import/[id]', { id: String(a.id) }));
				return;
			}
			pick = { kind: 'refused', ...refusalLines(a.reason) };
			return;
		}
	}

	async function cancel() {
		cancelled = true;
		if (token) await fetch(`/import/upload?token=${token}`, { method: 'DELETE' });
		token = '';
		pick = { kind: 'idle' };
	}

	function chosen() {
		const f = input?.files?.[0];
		if (f) void send(f);
		if (input) input.value = '';
	}

	function dropped(e: DragEvent) {
		e.preventDefault();
		over = false;
		const f = e.dataTransfer?.files?.[0];
		if (f) void send(f);
	}

	const pct = (p: { sent: number; size: number }) =>
		p.size > 0 ? Math.floor((p.sent / p.size) * 100) : 0;
</script>

<svelte:head><title>Import a backup · tsundoku</title></svelte:head>

<TopBar label="Import a backup">
	{#snippet left()}
		<a class="cellx back" href={resolve('/')}><span>←</span><span class="word">LIBRARY</span></a>
	{/snippet}
	{#snippet middle()}
		<div class="bar-title">
			<h1 class="t">IMPORT A BACKUP</h1>
			<div class="s">MIHON · ANIYOMI · LNREADER</div>
		</div>
	{/snippet}
</TopBar>
<!-- The way back to GET STARTED, while 03's trip lasts (doc/ONBOARDING.md, c511). -->
<StartTrail start={data.start} />

{#if data.tv}
	<!-- The TV never imports (c511): the server refuses, and says so here. -->
	<section class="pg" aria-label="Not on a TV">
		<div class="drop" role="alert">
			<div class="r ruled">
				<div class="tx">
					<div class="am">{data.tv.split(' · ')[0]}</div>
					<div class="b">{data.tv.split(' · ').slice(1).join(' · ')}</div>
				</div>
			</div>
		</div>
	</section>
{:else}
	<section class="pg" aria-label="Pick a file">
		<div class="k">00 — CHOOSE THE FILE</div>
		<h2 class="h1">Bring in a library from your phone's app.</h2>
		<p class="lede wide">
			Choose the backup file. tsundoku reads it and shows what's in it before anything is written.
			It tells which app it came from by itself.
		</p>
		<p class="lede narrow">
			Make a backup in the app, then choose it. It's usually in <b>Downloads</b>.
		</p>

		<input
			bind:this={input}
			type="file"
			class="file"
			accept=".tachibk,.proto.gz,.gz,.zip,application/octet-stream,application/gzip,application/zip"
			aria-label="The backup file"
			onchange={chosen}
			tabindex="-1"
		/>

		{#if pick.kind === 'idle'}
			<div
				class="drop"
				class:over
				role="group"
				aria-label="Drop the backup here"
				ondragover={(e) => {
					e.preventDefault();
					over = true;
				}}
				ondragleave={() => (over = false)}
				ondrop={dropped}
			>
				<div class="big wide">Drop the backup here</div>
				<button type="button" class="btn primary lg" onclick={() => input?.click()}>
					<span class="wide">CHOOSE A FILE…</span><span class="narrow">CHOOSE THE BACKUP FILE</span>
				</button>
				<div class="sm wide">.tachibk FROM MIHON OR ANIYOMI · .zip FROM LNREADER</div>
			</div>
			<div class="note narrow">
				OPENS THE PHONE'S OWN FILE PICKER · THE FILE GOES TO YOUR COMPUTER, WHERE THE LIBRARY IS
			</div>
		{:else if pick.kind === 'uploading'}
			<div class="drop has" role="status">
				<div class="r">
					<div class="tx">
						<div class="am">{pick.name}</div>
						<div class="b">{sizeWords(pick.size)} · UPLOADING · {pct(pick)}%</div>
					</div>
					<button type="button" class="ac q" onclick={cancel}>CANCEL</button>
				</div>
				<div class="prog"><i style:width="{pct(pick)}%"></i></div>
			</div>
		{:else if pick.kind === 'reading'}
			<div class="drop has" role="status">
				<div class="r">
					<div class="tx">
						<div class="am">READING · {pick.name}</div>
						<div class="b">{sizeWords(pick.size)} · NOTHING IS WRITTEN WHILE IT READS</div>
					</div>
				</div>
				<div class="prog wait"></div>
			</div>
		{:else}
			<div class="drop has" role="alert">
				<div class="r ruled">
					<div class="tx">
						<div class="am">{pick.a}</div>
						<div class="b">{pick.b}</div>
					</div>
					<button type="button" class="ac" onclick={() => input?.click()}>CHOOSE ANOTHER</button>
				</div>
			</div>
		{/if}

		<div class="lab">
			<span>01 — WHERE EACH APP MAKES ONE</span><span class="r wide"
				>[CHECK] AGAINST CURRENT BUILDS</span
			>
		</div>
		<div class="blk">
			<div class="r">
				<div class="tx">
					<div class="a">Mihon</div>
					<div class="b">MORE › SETTINGS › DATA AND STORAGE › CREATE BACKUP</div>
				</div>
				<div class="cl wide">MANGA, MANHWA</div>
			</div>
			<div class="r later">
				<div class="tx">
					<div class="a">Aniyomi</div>
					<div class="b">MORE › SETTINGS › DATA AND STORAGE › CREATE BACKUP</div>
				</div>
				<div class="cl">NOT YET</div>
			</div>
			<div class="r later">
				<div class="tx">
					<div class="a">LNReader</div>
					<div class="b">MORE › SETTINGS › BACKUP › CREATE BACKUP</div>
				</div>
				<div class="cl">NOT YET</div>
			</div>
		</div>
		<div class="note narrow">[CHECK] MENU PATHS AGAINST CURRENT BUILDS</div>
		<div class="note">
			ANIYOMI AND LNREADER BACKUPS ARE NOT READ YET: THEIR IMPORTERS ARE STILL BEING BUILT
		</div>

		<div class="two wide">
			<div>
				<div class="k">THE BACKUP IS ON THE PHONE?</div>
				<p class="prose">
					Open tsundoku on the phone and choose it there, from Downloads. No cable, no folder.
				</p>
				<a class="go" href="{resolve('/settings')}#s-devices"
					>PAIR A PHONE · SETTINGS › 08 — DEVICES →</a
				>
			</div>
			<div>
				<div class="k">NOTHING IS WRITTEN YET</div>
				<p class="prose">
					The next screen says what the file holds and which sources it needs. IMPORT is the only
					button that changes the library.
				</p>
			</div>
		</div>
	</section>
{/if}

<style>
	.back {
		border-right: var(--hairline);
	}
	.h1 {
		margin: 10px 0 0;
		font: 500 34px/1.2 var(--font-sans);
	}
	.file {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
		pointer-events: none;
	}
	.drop {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 18px;
		min-height: 240px;
		margin-top: 28px;
		padding: 32px;
		border: 1px dashed var(--line-2);
	}
	.drop.over {
		border-color: var(--accent);
	}
	.drop .big {
		font: 500 22px/1.3 var(--font-sans);
	}
	.drop .sm {
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}
	.drop.has {
		border: 1px solid var(--text-1);
		align-items: stretch;
		justify-content: flex-start;
		min-height: 0;
		padding: 0;
		gap: 0;
	}
	.later .tx {
		opacity: 0.55;
	}
	/* Two ruled cells (Import-Pick, extracted): 1px gap on the hairline colour. */
	.two {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1px;
		margin-top: 28px;
		border: var(--hairline);
		background: var(--line-1);
	}
	.two > div {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 20px;
		background: var(--surface-page);
	}
	.two .k {
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
		color: var(--text-1);
	}
	.two .prose {
		font-size: 15px;
		line-height: 1.55;
	}
	.go {
		font: 500 13px var(--font-mono);
		color: var(--accent);
		text-decoration: none;
	}
	.narrow {
		display: none;
	}
	@media (max-width: 599px) {
		.wide {
			display: none;
		}
		.narrow {
			display: revert;
		}
		.h1 {
			font-size: 26px;
		}
		.back .word {
			display: none;
		}
		.drop:not(.has) {
			min-height: 0;
			padding: 0;
			border: 0;
			margin-top: 24px;
		}
		.drop:not(.has) .btn {
			width: 100%;
		}
	}
</style>
