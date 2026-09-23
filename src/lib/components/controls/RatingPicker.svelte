<script lang="ts">
	import { RATING_OPTIONS, ratingLabel } from '$lib/library/rating';
	import type { Rating } from '$lib/library/types';

	/**
	 * Seven cells: `—` (unrated) then 0-5, the chosen one filled with the
	 * accent. `value` undefined means "no single value", which is the bulk bar:
	 * rating three series at once has no current rating to show.
	 *
	 * Cells are submit buttons when `name` is given, so the picker works inside
	 * a plain form with no script.
	 */
	let {
		value,
		label = 'Rating',
		height = 64,
		labelWidth = 120,
		fontSize = 15,
		name,
		onchange
	}: {
		value?: Rating;
		label?: string | null;
		height?: number;
		/** The label cell's width; null lets it size to its text. */
		labelWidth?: number | null;
		fontSize?: number;
		name?: string;
		onchange?: (rating: Rating) => void;
	} = $props();
</script>

<div class="picker" style:height="{height}px" role="group" aria-label={label ?? 'Rating'}>
	{#if label}
		<div class="label" style:width={labelWidth != null ? `${labelWidth}px` : undefined}>
			{label}
		</div>
	{/if}
	{#each RATING_OPTIONS as option (option)}
		{@const on = value !== undefined && option === value}
		<button
			type={name ? 'submit' : 'button'}
			{name}
			value={option === null ? '' : String(option)}
			class="cell"
			class:on
			class:clear={option === null}
			style:font-size="{fontSize}px"
			aria-pressed={on}
			aria-label={option === null ? 'Unrated' : `Rate ${option}`}
			onclick={() => onchange?.(option)}>{ratingLabel(option)}</button
		>
	{/each}
</div>

<style>
	.picker {
		display: flex;
		align-items: stretch;
		border-bottom: var(--hairline);
	}
	.label {
		display: flex;
		align-items: center;
		flex-shrink: 0;
		padding: 0 var(--pad);
		font: var(--type-label);
		color: var(--text-2);
		border-right: var(--hairline);
		text-transform: uppercase;
	}
	.cell {
		flex: 1;
		min-width: 0;
		border: 0;
		border-right: var(--hairline);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font-family: var(--font-mono);
		font-weight: 500;
		cursor: pointer;
		padding: 0;
	}
	.cell:last-child {
		border-right: 0;
	}
	.clear {
		color: var(--text-2);
	}
	.on {
		background: var(--accent);
		color: var(--on-accent);
	}
	.cell:active:not(.on) {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
</style>
