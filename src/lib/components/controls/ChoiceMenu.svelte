<script lang="ts" generics="V extends string">
	import { focusScope } from '$lib/focus';
	import { leave } from '$lib/motion';

	/**
	 * One choice out of a few, the house's way (c432; doc/LIBRARY.md, "Sort and
	 * direction"): a cell naming the choice, with ▾, that opens a list of blocky
	 * cells as FILTER's rows draw them, the chosen one inverted. It replaced the
	 * library's native SORT `<select>`, whose open list was the system's.
	 *
	 * - Picking a choice calls `onpick` and closes the list. Picking the one
	 *   already chosen only closes it.
	 * - Escape, a tap anywhere outside, or the cell again close it without
	 *   picking.
	 * - The open list is a focus scope (doc/FOCUS.md): on a TV or a keyboard
	 *   OK opens it on the current choice, the arrows walk the choices, OK
	 *   picks, and BACK (Escape) closes it. Either way focus goes back to the
	 *   cell.
	 *
	 * Not positioned: the list hangs under the nearest positioned ancestor,
	 * right-aligned and at least its width, so the caller decides what it
	 * hangs from (the library hangs it from the whole SORT block, ↓ / ↑
	 * included), as FilterPanel's panel does.
	 */
	let {
		label,
		choices,
		value,
		onpick
	}: {
		/** What is being chosen, for a screen reader: "Sort". */
		label: string;
		choices: readonly { value: V; label: string }[];
		value: V;
		onpick: (v: V) => void;
	} = $props();

	let open = $state(false);
	let root = $state<HTMLElement | null>(null);
	const current = $derived(choices.find((c) => c.value === value) ?? choices[0]);

	function pick(v: V) {
		open = false;
		if (v !== value) onpick(v);
	}

	function keydown(e: KeyboardEvent) {
		if (open && e.key === 'Escape') {
			open = false;
			e.preventDefault();
		}
	}

	// A tap outside closes it, wherever it lands: the scrim takes the ones on
	// the page, and this the ones on what sits above the scrim (the top bar).
	function pointerdown(e: PointerEvent) {
		if (open && root && e.target instanceof Node && !root.contains(e.target)) open = false;
	}
</script>

<svelte:window onkeydown={keydown} />
<svelte:document onpointerdown={pointerdown} />

<span class="menu" bind:this={root}>
	<button
		type="button"
		class="cell"
		class:on={open}
		aria-haspopup="menu"
		aria-expanded={open}
		aria-label="{label}, {current?.label ?? ''}"
		data-focus-mark="in"
		onclick={() => (open = !open)}
		>{current?.label}<span class="caret" aria-hidden="true">{open ? '▴' : '▾'}</span></button
	>
	{#if open}
		<button
			type="button"
			class="scrim"
			tabindex="-1"
			aria-label="Close the menu"
			data-press="off"
			onclick={() => (open = false)}
			out:leave
		></button>
		<div class="list appear" role="menu" aria-label={label} use:focusScope out:leave>
			{#each choices as c (c.value)}
				<button
					type="button"
					class="opt"
					class:on={c.value === value}
					role="menuitemradio"
					aria-checked={c.value === value}
					data-focus-mark="in"
					data-focus-start={c.value === value ? '' : undefined}
					data-press="fill"
					onclick={() => pick(c.value)}>{c.label}</button
				>
			{/each}
		</div>
	{/if}
</span>

<style>
	/* Two classes a rule: a caller's container may unset its buttons
	   (SectionLabel's `.right button { all: unset }`), and this must still win. */
	.menu {
		display: flex;
	}
	.menu > .cell {
		display: flex;
		align-items: center;
		gap: 12px;
		box-sizing: border-box;
		padding: 0 12px;
		font: inherit;
		letter-spacing: inherit;
		color: inherit;
		white-space: nowrap;
		cursor: pointer;
	}
	/* Open, the cell stays lit above the scrim, as FILTER's does, and takes
	   the second tap itself. */
	.menu > .cell.on {
		position: relative;
		z-index: 7;
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	/* The house's mark inside the cell (focus.css), which a caller's
	   `all: unset` would otherwise have taken off. */
	.menu > .cell:focus-visible,
	.list > .opt:focus-visible {
		outline: none;
		box-shadow: var(--focus-ring-in);
	}
	.menu > .scrim {
		position: fixed;
		inset: 0;
		z-index: 6;
		border: 0;
		border-radius: 0;
		padding: 0;
		background: transparent;
		cursor: default;
	}
	/* FILTER's panel, as a column: the full-ink rule on top, hairlines between.
	   7, under a top bar (8): a caller that draws something at 7 or above
	   between the cell and the list's foot steps it down while the list is
	   open, as the library does its KIND band (c590). */
	.menu > .list {
		position: absolute;
		top: 100%;
		right: -1px;
		z-index: 7;
		display: flex;
		flex-direction: column;
		min-width: calc(100% + 2px);
		box-sizing: border-box;
		background: var(--surface-page);
		border: 1px solid var(--line-2);
		border-top: 1px solid var(--text-1);
	}
	.list > .opt {
		display: flex;
		align-items: center;
		min-height: 52px;
		box-sizing: border-box;
		padding: 0 14px;
		border-bottom: var(--hairline);
		background: transparent;
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		letter-spacing: normal;
		white-space: nowrap;
		cursor: pointer;
	}
	.list > .opt:last-child {
		border-bottom: 0;
	}
	.list > .opt.on {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
</style>
