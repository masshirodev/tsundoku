<script lang="ts">
	/** A square switch. The only animated thing in the system: 120ms on the knob. */
	let {
		checked = false,
		label,
		name,
		value,
		onchange
	}: {
		checked?: boolean;
		label?: string;
		/** When given, the switch is a submit button carrying `value`. */
		name?: string;
		value?: string;
		onchange?: (checked: boolean) => void;
	} = $props();
</script>

<button
	type={name ? 'submit' : 'button'}
	{name}
	{value}
	class="switch"
	role="switch"
	aria-checked={checked}
	onclick={() => onchange?.(!checked)}
>
	<span class="track" class:on={checked}><span class="knob"></span></span>
	{label ?? (checked ? 'ON' : 'OFF')}
</button>

<style>
	.switch {
		display: inline-flex;
		align-items: center;
		gap: 12px;
		background: none;
		border: 0;
		color: var(--text-1);
		font: 500 15px var(--font-mono);
		cursor: pointer;
		padding: 0;
		min-height: var(--hit-min);
	}
	.track {
		position: relative;
		width: 44px;
		height: 24px;
		border: 1px solid var(--line-2);
	}
	.track.on {
		background: var(--accent);
		border-color: var(--accent);
	}
	.knob {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 18px;
		height: 18px;
		background: var(--text-2);
		transition: left var(--motion-fast) var(--ease);
	}
	.on .knob {
		left: 22px;
		background: var(--on-accent);
	}
</style>
