<script lang="ts">
	import { leave } from '$lib/motion';
	import { lockPage } from '$lib/scroll-lock';
	import { goto } from '$app/navigation';

	/**
	 * + NEW, the last tab on the phone and tablet (Library Filters 3g): one
	 * field in a sheet, landing on the new shelf. It's open while the URL says
	 * `?new=shelf`, so the tab is a plain link, ✕ a link back, and CREATE posts
	 * the form: it all works without script. The desktop makes a shelf in the
	 * sidebar instead (+layout.svelte), so this sheet isn't drawn there.
	 */
	let { closeHref }: { closeHref: string } = $props();

	let name = $state('');

	function keydown(e: KeyboardEvent) {
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- the caller's href resolves
		if (e.key === 'Escape') void goto(closeHref, { noScroll: true, replaceState: true });
	}

	// Drawn only while open: the page under its scrim holds still for as long
	// as it is, as under a Sheet (src/lib/scroll-lock.ts, c1033).
	$effect(() => lockPage());
</script>

<svelte:window onkeydown={keydown} />

<div class="new-shelf">
	<!-- eslint-disable svelte/no-navigation-without-resolve -- the caller's href resolves -->
	<a class="scrim appear" out:leave href={closeHref} aria-label="Close" data-sveltekit-noscroll></a>
	<div class="sheet rise" out:leave={'down'} role="dialog" aria-modal="true" aria-label="New shelf">
		<div class="head">
			<span>NEW SHELF</span>
			<a class="x" href={closeHref} aria-label="Close" data-sveltekit-noscroll>✕</a>
		</div>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
		<form method="POST" action="?/newShelf">
			<div class="field">
				<!-- The sheet exists to take this one name. -->
				<!-- svelte-ignore a11y_autofocus -->
				<input
					name="name"
					bind:value={name}
					aria-label="Shelf name"
					autocomplete="off"
					required
					autofocus
				/>
			</div>
			<div class="note">EMPTY UNTIL YOU ADD TO IT</div>
			<button type="submit" class="create" disabled={name.trim() === ''}
				>CREATE {name.trim().toUpperCase()}</button
			>
		</form>
	</div>
</div>

<style>
	/* Library Filters 3g, transcribed. */
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 20;
		background: var(--scrim);
	}
	.sheet {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 21;
		display: flex;
		flex-direction: column;
		background: var(--surface-page);
		border-top: 1px solid var(--text-1);
	}
	.head {
		display: flex;
		height: 52px;
		border-bottom: var(--hairline);
	}
	.head span {
		flex: 1;
		display: flex;
		align-items: center;
		padding: 0 16px;
		font: 500 13px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.x {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 52px;
		border-left: var(--hairline);
		font: 500 16px var(--font-mono);
		color: var(--text-1);
	}
	.field {
		padding: 16px 16px 10px;
	}
	.field input {
		box-sizing: border-box;
		width: 100%;
		height: 52px;
		padding: 0 14px;
		border: 1px solid var(--text-1);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 400 17px var(--font-sans);
		caret-color: var(--accent);
		outline: none;
	}
	.note {
		padding: 0 16px 16px;
		font: 400 12px/1.4 var(--font-mono);
		color: var(--text-2);
	}
	.create {
		width: 100%;
		height: 56px;
		border: 0;
		border-radius: 0;
		background: var(--accent);
		color: var(--on-accent);
		font: 500 15px var(--font-mono);
		cursor: pointer;
	}
	.create:disabled {
		opacity: 0.4;
		cursor: default;
	}
	/* The desktop makes a shelf in the sidebar, in place (3j). */
	@media (min-width: 1024px) and (pointer: fine) {
		.new-shelf {
			display: none;
		}
	}
</style>
