<script lang="ts">
	import type { Snippet } from 'svelte';
	import { coverPlaceholder } from '$lib/library/cover';

	/**
	 * One row of EXTENSIONS (Index-Extensions): icon, name (18+ inside reveal),
	 * a line that may lead with a state in a word, then KIND · LANGUAGE,
	 * VERSION and two action cells. A state that needs a hand is c94's failed
	 * row: a 3px ink rule on the left, no new colour. `icon` is null for a
	 * repository, drawn as an empty outlined box.
	 */
	let {
		name,
		icon,
		hue = 200,
		state = '',
		quiet = false,
		sub = '',
		kind,
		version,
		versionInk = false,
		rule = false,
		adult = false,
		hidden = false,
		actions
	}: {
		name: string;
		icon: string | null;
		hue?: number;
		/** "FAILED TO LOAD · PROTOBUF", "INSTALLED": the line's lead. */
		state?: string;
		/** A state that's news (ink 500), or just a fact (INSTALLED, grey). */
		quiet?: boolean;
		sub?: string;
		kind: string;
		version: string;
		/** An update waiting: the version line in ink. */
		versionInk?: boolean;
		rule?: boolean;
		adult?: boolean;
		hidden?: boolean;
		actions?: Snippet;
	} = $props();
</script>

<div class="row" class:rule>
	<div class="main">
		<span
			class="icon"
			class:repo={icon === null}
			style:background={icon === null
				? 'transparent'
				: `center / cover no-repeat url(${icon}), ${coverPlaceholder(hue)}`}
		>
			{#if hidden}<span class="hid">HIDDEN</span>{/if}
		</span>
		<span class="text">
			<span class="top"
				><span class="t">{name}</span>{#if adult}<span class="adult">18+</span>{/if}</span
			>
			<span class="m"
				>{#if state}<span class="lead" class:quiet>{state}</span>{/if}{sub}</span
			>
		</span>
	</div>
	<div class="kind">{kind}</div>
	<div class="ver" class:ink={versionInk}>{version}</div>
	<div class="acts">{@render actions?.()}</div>
</div>

<style>
	/* Index-Extensions, transcribed: the mock's literals; colours are tokens. */
	.row {
		display: flex;
		align-items: stretch;
		min-height: 64px;
		border-bottom: var(--hairline);
	}
	.rule {
		box-shadow: inset 3px 0 0 var(--text-1);
	}
	.main {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 10px 0 10px var(--pad);
	}
	.icon {
		position: relative;
		flex-shrink: 0;
		width: 40px;
		height: 40px;
		box-sizing: border-box;
	}
	.icon.repo {
		border: 1px solid var(--line-2);
	}
	.hid {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		padding: 2px 0;
		text-align: center;
		background: var(--reveal);
		color: var(--on-reveal);
		font: 500 8px/1 var(--font-mono);
	}
	.text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 5px;
	}
	.top {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}
	.t {
		font: 500 16px/1.3 var(--font-sans);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.adult {
		flex-shrink: 0;
		padding: 2px 5px;
		background: var(--reveal);
		color: var(--on-reveal);
		font: 500 11px var(--font-mono);
	}
	.m {
		font: 400 13px/1.3 var(--font-mono);
		color: var(--text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.lead {
		color: var(--text-1);
		font-weight: 500;
	}
	.lead.quiet {
		color: var(--text-2);
		font-weight: 400;
	}
	.kind {
		display: flex;
		align-items: center;
		width: 160px;
		flex-shrink: 0;
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}
	.ver {
		display: flex;
		align-items: center;
		width: 190px;
		flex-shrink: 0;
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}
	.ver.ink {
		font-weight: 500;
		color: var(--text-1);
	}
	.acts {
		display: flex;
		width: 300px;
		flex-shrink: 0;
	}
	/* Each action is a cell: a link, or a form whose button fills it. */
	.acts > :global(*) {
		flex: 1;
		display: flex;
	}
	.acts :global(.act) {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0 8px;
		border: 0;
		border-left: var(--hairline);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
		white-space: nowrap;
		text-decoration: none;
		cursor: pointer;
	}
	.acts :global(.act.accent) {
		background: var(--accent);
		color: var(--on-accent);
	}
	.acts :global(.act.ink) {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.acts :global(.act.muted) {
		color: var(--text-2);
		cursor: default;
	}
	.acts :global(.act:disabled) {
		opacity: 0.4;
		cursor: default;
	}
	/* The tablet: KIND · LANGUAGE folds away; the phone: the version too, and
	   the actions take their own line under the row. */
	@media (max-width: 1023px) {
		.kind {
			display: none;
		}
		.ver {
			width: 120px;
		}
		.acts {
			width: 220px;
		}
	}
	@media (max-width: 599px) {
		.row {
			flex-wrap: wrap;
		}
		.main {
			flex-basis: 100%;
			padding-right: var(--pad);
		}
		.ver {
			display: none;
		}
		.acts {
			width: 100%;
			min-height: 48px;
			border-top: var(--hairline);
		}
		.acts :global(.act:first-child) {
			border-left: 0;
		}
	}
</style>
