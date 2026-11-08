<script lang="ts">
	import { leave } from '$lib/motion';
	import type { MenuRow } from '$lib/library/cover-menu';
	import { focusScope } from '$lib/focus';

	/**
	 * The image reader's copy of the shared page menu
	 * (`$lib/components/content/PageMenu.svelte`), with one row more: HIGHLIGHT
	 * THIS PAGE, first, since it is the one used on any page (Highlights H3,
	 * c703; Manga M5). A copy because the shared one is the PAGES grid's too
	 * and its rows are covers' (`MenuRow`'s targets); everything below the
	 * highlight's row is the shared menu's, unchanged.
	 *
	 * The page menu (Page Menu, card c26; doc/COVERS.md, "Chosen"): what a
	 * long-pressed page can become. The pressed page keeps its light, ringed in
	 * the accent with its number in the corner; everything else goes under the
	 * scrim. One row per thing the page can become, each saying where that
	 * cover comes from now. Closes by ✕, a tap on the scrim, or Esc.
	 *
	 * In the reader it's the reader's dark chrome, with a preview of the page
	 * as a tile would crop it. On the PAGES grid it follows the app's theme,
	 * has no preview (the cell is one), and ends with the cell's own action.
	 */
	let {
		page,
		pages,
		rect,
		title = '',
		meta = '',
		preview = null,
		rows,
		offline = false,
		readHref = null,
		highlight = null,
		onhighlight,
		onchoose,
		onclose
	}: {
		/** 0-based. */
		page: number;
		pages: number;
		/** The pressed page on screen, ringed; the rest is under the scrim. */
		rect: { left: number; top: number; width: number; height: number };
		title?: string;
		meta?: string;
		/** The page's image, for the preview; none on the grid. */
		preview?: string | null;
		rows: MenuRow[];
		offline?: boolean;
		/** The grid's last row: READ FROM this page. */
		readHref?: string | null;
		/**
		 * The highlight's row: kept (✓ HIGHLIGHTED · OPEN), or not; disabled in
		 * incognito, which makes none, and offline, as the cover rows are.
		 */
		highlight?: { kept: boolean; incognito: boolean } | null;
		onhighlight?: () => void;
		onchoose: (row: MenuRow) => void;
		onclose: () => void;
	} = $props();
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape') {
			e.stopPropagation();
			onclose();
		}
	}}
	onresize={onclose}
/>

<!-- The scrim takes every tap: nothing reaches the page while the menu is open. -->
<button type="button" class="catcher" aria-label="Close the page menu" onclick={onclose}></button>
<div
	class="hole"
	aria-hidden="true"
	style:left="{rect.left}px"
	style:top="{rect.top}px"
	style:width="{rect.width}px"
	style:height="{rect.height}px"
>
	<span class="pn">P. {page + 1}</span>
</div>

<div
	class="sheet rise"
	out:leave={'down'}
	class:grid={!preview}
	aria-label="Page {page + 1}"
	role="dialog"
	aria-modal="true"
	use:focusScope={{ force: true }}
>
	<div class="head">
		<div class="hl">PAGE · P. {page + 1} OF {pages}</div>
		<button type="button" class="x" aria-label="Close" onclick={onclose}>✕</button>
	</div>
	{#if preview}
		<div class="info">
			<div class="preview"><img src={preview} alt="" draggable="false" /></div>
			<div class="text">
				<div class="title">{title}</div>
				{#if meta}<div class="meta">{meta}</div>{/if}
				<div class="meta">
					<span class="long">AS A TILE: THE TOP OF THE PAGE</span><span class="short"
						>AS A TILE: THE TOP</span
					>
				</div>
			</div>
		</div>
	{/if}
	{#if offline}
		<div class="off">
			<span>○ OFFLINE</span><span class="dim"
				>{highlight
					? 'HIGHLIGHTS AND COVERS NEED THE WORKSTATION'
					: 'COVERS NEED THE WORKSTATION'}</span
			>
		</div>
	{/if}
	{#if highlight}
		<!-- Its own label class: `.label` is the cover rows' (cover-menu-flow lists them). -->
		<div class="row hl-row">
			<div class="hl-label">HIGHLIGHT</div>
			<button
				type="button"
				class="act"
				disabled={highlight.incognito || (offline && !highlight.kept)}
				data-focus-start=""
				onclick={() => onhighlight?.()}
			>
				<span class="line"
					>{#if highlight.kept}<b>✓ HIGHLIGHTED</b>{:else if highlight.incognito}<span
							>INCOGNITO MAKES NONE</span
						>{:else}<span>A COPY OF THIS PAGE, KEPT FOR GOOD</span>{/if}</span
				>
				<span class="do">{highlight.kept ? 'OPEN' : 'HIGHLIGHT THIS PAGE'}</span>
			</button>
		</div>
	{/if}
	{#each rows as row, i (row.target)}
		<div class="row">
			<div class="label">{row.label}</div>
			<button
				type="button"
				class="act"
				class:this={row.isThis}
				disabled={offline}
				data-focus-start={i === 0 && !highlight ? '' : undefined}
				onclick={() => onchoose(row)}
			>
				<span class="line"
					>{#if row.isThis}<b>✓ THIS PAGE</b>{/if}<span>{row.line}</span></span
				>
				<span class="do">{row.action}</span>
			</button>
		</div>
	{/each}
	{#if readHref}
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolved by the caller -->
		<a class="read" href={readHref}>▶ READ FROM P. {page + 1}</a>
	{:else}
		<div class="foot"></div>
	{/if}
</div>

<style>
	.catcher {
		position: fixed;
		inset: 0;
		z-index: 60;
		border: 0;
		background: transparent;
		cursor: default;
	}
	/* The pressed page: its light kept, ringed, the rest dimmed around it. */
	.hole {
		position: fixed;
		z-index: 61;
		pointer-events: none;
		box-shadow:
			inset 0 0 0 3px var(--accent),
			0 0 0 4000px rgba(0, 0, 0, 0.6);
	}
	.pn {
		position: absolute;
		left: 0;
		top: 0;
		padding: 4px 7px;
		background: var(--accent);
		color: var(--on-accent);
		font: 500 12px var(--font-mono);
	}
	.sheet {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 62;
		display: flex;
		flex-direction: column;
		max-height: 90dvh;
		overflow-y: auto;
		background: var(--surface-page);
		color: var(--text-1);
		border-top: 1px solid var(--text-1);
	}
	.head {
		display: flex;
		height: 56px;
		flex-shrink: 0;
		border-bottom: 1px solid var(--line-1);
	}
	.hl {
		flex: 1;
		display: flex;
		align-items: center;
		padding: 0 24px;
		font: 500 13px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.x {
		display: flex;
		align-items: center;
		padding: 0 24px;
		border: 0;
		border-left: 1px solid var(--line-1);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 18px var(--font-mono);
		cursor: pointer;
	}
	.info {
		display: flex;
		gap: 20px;
		padding: 24px;
		border-bottom: 1px solid var(--line-1);
	}
	.preview {
		width: 96px;
		height: 139px;
		flex-shrink: 0;
		background: var(--surface-panel);
		overflow: hidden;
	}
	.preview img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		object-position: top;
	}
	.text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.title {
		font: 500 22px/1.25 var(--font-sans);
	}
	.meta {
		font: 400 14px var(--font-mono);
		color: var(--text-2);
	}
	.meta .short {
		display: none;
	}
	.off {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 48px;
		padding: 12px 24px;
		border-bottom: 1px solid var(--line-1);
		background: var(--surface-panel);
		font: 500 13px var(--font-mono);
	}
	.dim {
		font-weight: 400;
		color: var(--text-2);
	}
	.row {
		display: flex;
		height: 64px;
		flex-shrink: 0;
		border-bottom: 1px solid var(--line-1);
	}
	.label,
	.hl-label {
		display: flex;
		align-items: center;
		width: 120px;
		flex-shrink: 0;
		padding: 0 24px;
		border-right: 1px solid var(--line-1);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	/* The rest of the row is the button: where the cover comes from now, then the action cell. */
	.act {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: stretch;
		padding: 0;
		border: 0;
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		text-align: left;
		cursor: pointer;
	}
	.line {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 0 18px;
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}
	.line b {
		font-weight: 500;
		color: var(--accent);
	}
	.do {
		display: flex;
		align-items: center;
		padding: 0 24px;
		border-left: 1px solid var(--line-1);
		font: 500 14px var(--font-mono);
		white-space: nowrap;
	}
	.act:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.act:not(:disabled):active .do,
	.act:not(:disabled):hover .do {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.foot {
		height: 24px;
		flex-shrink: 0;
	}
	.read {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 64px;
		flex-shrink: 0;
		background: var(--accent);
		color: var(--on-accent);
		font: 500 15px var(--font-mono);
		text-decoration: none;
	}

	/* The phone, and the PAGES grid: the label cell narrows to 88px and the rest of the row is one button, its words over the source. */
	@media (max-width: 599px) {
		.hl {
			padding: 0 16px;
		}
		.x {
			padding: 0 18px;
		}
		.info {
			gap: 14px;
			padding: 16px;
		}
		.preview {
			width: 72px;
			height: 104px;
		}
		.text {
			gap: 6px;
		}
		.title {
			font-size: 17px;
			line-height: 1.3;
		}
		.meta {
			font-size: 13px;
			line-height: 1.3;
		}
		.meta .long {
			display: none;
		}
		.meta .short {
			display: inline;
		}
		.off {
			padding: 12px 16px;
		}
		.foot {
			height: 16px;
		}
	}
	@media (max-width: 599px) {
		.row {
			height: auto;
			min-height: 64px;
		}
		.label,
		.hl-label {
			width: 88px;
			padding: 0 14px;
		}
		.act {
			flex-direction: column-reverse;
			justify-content: center;
			gap: 4px;
			padding: 10px 14px;
		}
		.line {
			flex: none;
			padding: 0;
			font-size: 12px;
			gap: 8px;
		}
		.do {
			padding: 0;
			border-left: 0;
		}
		.act:not(:disabled):active .do,
		.act:not(:disabled):hover .do {
			background: none;
			color: inherit;
		}
		.act:not(:disabled):active {
			background: var(--surface-inverse);
			color: var(--text-inverse);
		}
	}
	/* The grid's sheet is the phone's shape at any width (1i). */
	.sheet.grid .row {
		height: auto;
		min-height: 64px;
	}
	.sheet.grid .label,
	.sheet.grid .hl-label {
		width: 88px;
		padding: 0 14px;
	}
	.sheet.grid .act {
		flex-direction: column-reverse;
		justify-content: center;
		gap: 4px;
		padding: 10px 14px;
	}
	.sheet.grid .line {
		flex: none;
		padding: 0;
		font-size: 12px;
		gap: 8px;
	}
	.sheet.grid .do {
		padding: 0;
		border-left: 0;
	}
	.sheet.grid .hl {
		padding: 0 16px;
	}
	.sheet.grid .x {
		padding: 0 18px;
	}

	/*
	 * The TV (c235; TV-Reader 7F): the menu is the 420px panel from the right,
	 * as every sheet is there, and the page it means is framed in ink rather
	 * than in the accent -- the accent means "yours", the frame is where the
	 * remote is.
	 */
	@media (pointer: none) and (min-width: 900px) {
		.sheet {
			left: auto;
			right: 0;
			top: 0;
			bottom: 0;
			width: var(--tv-panel-w);
			max-height: none;
			border-top: 0;
			border-left: var(--rule-strong);
			padding-bottom: var(--safe-y);
		}
		.row,
		.sheet.grid .row {
			min-height: 72px;
		}
		.hole {
			box-shadow:
				inset 0 0 0 4px var(--text-1),
				0 0 0 4000px rgba(0, 0, 0, 0.6);
		}
		.pn {
			background: var(--surface-page);
			color: var(--text-1);
			border-right: var(--hairline);
			border-bottom: var(--hairline);
		}
	}
</style>
