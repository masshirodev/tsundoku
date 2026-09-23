<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	/** Square, uppercase mono. `lg` is the 56px empty-state action. */
	type Variant = 'primary' | 'outline' | 'inverse' | 'ghost';
	let {
		variant = 'outline',
		size = 'md',
		block = false,
		children,
		...rest
	}: HTMLButtonAttributes & {
		variant?: Variant;
		size?: 'sm' | 'md' | 'lg';
		block?: boolean;
		children: Snippet;
	} = $props();
</script>

<button type="button" class="btn {variant} {size}" class:block {...rest}
	>{@render children()}</button
>

<style>
	.btn {
		height: 48px;
		padding: 0 16px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		border-radius: 0;
		cursor: pointer;
		font: var(--type-control);
		text-transform: uppercase;
	}
	.sm {
		height: 40px;
	}
	.lg {
		height: 56px;
		padding: 0 28px;
		font: 500 16px var(--font-mono);
	}
	.block {
		width: 100%;
	}
	.btn:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.primary {
		background: var(--accent);
		color: var(--on-accent);
		border: 1px solid var(--accent);
	}
	.outline {
		background: transparent;
		color: var(--text-1);
		border: 1px solid var(--line-2);
	}
	.inverse {
		background: var(--surface-inverse);
		color: var(--text-inverse);
		border: 1px solid var(--surface-inverse);
	}
	.ghost {
		background: transparent;
		color: var(--text-1);
		border: 1px solid transparent;
	}
	.outline:active:not(:disabled),
	.ghost:active:not(:disabled) {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
</style>
