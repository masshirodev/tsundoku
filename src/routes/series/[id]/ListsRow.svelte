<script lang="ts">
	import { enhance } from '$app/forms';
	import type { Cell, Lists, SheetAt } from './lists';

	/**
	 * LISTS (doc/SERIES.md): one row, a line per list. Each line is the entry
	 * it is linked to, what the list says of it, what was sent, and its cells.
	 * `lists.ts` decides every word and cell; this only draws them.
	 *
	 * The label is a 36px strip above the lines on the phone, the 440px panel
	 * and the TV, so each line has the full width; on the tablet in portrait
	 * the row has room for the label column, like the rows around it. One cell
	 * stays at its line's end; two or more drop under it in equal columns,
	 * except on the tablet in portrait, which keeps them inline.
	 */
	let {
		lists,
		onedit,
		onexpand
	}: {
		lists: Lists;
		/** EDIT on a line: the sheet, on that line's entry and season. */
		onedit: (at: SheetAt) => void;
		/** SHOW on a fold, or SHOW/HIDE on the seasons' toggle. */
		onexpand: () => void;
	} = $props();
</script>

{#snippet cell(c: Cell)}
	{#if c.dim}
		<span class="c dim" class:acc={c.accent} aria-disabled="true">{c.label}</span>
	{:else if c.edit}
		{@const at = c.edit}
		<button type="button" class="c" data-focus-mark="in" onclick={() => onedit(at)}
			>{c.label}</button
		>
	{:else if c.post}
		<form method="POST" action={c.post.action} use:enhance class="cf">
			{#each Object.entries(c.post.fields) as [name, value] (name)}
				<input type="hidden" {name} {value} />
			{/each}
			<button type="submit" class="c" class:acc={c.accent} data-focus-mark="in">{c.label}</button>
		</form>
	{:else if c.external}
		<a
			class="c"
			class:acc={c.accent}
			href={c.href}
			target="_blank"
			rel="noopener noreferrer external"
			data-focus-mark="in">{c.label}</a
		>
	{:else}
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- built from resolve() in lists.ts -->
		<a class="c" class:acc={c.accent} href={c.href} data-focus-mark="in">{c.label}</a>
	{/if}
{/snippet}

<div class="lists-row" data-row="lists">
	<div class="lab">LISTS</div>
	<div class="lists">
		<div class="strip" class:noted={!!lists.note}>
			<span class="strip-l">LISTS</span>
			{#if lists.note}<span class="note">{lists.note}</span>{/if}
		</div>
		{#each lists.items as item (item.type === 'line' ? item.line.key : item.type === 'fold' ? `f${item.above ? 'up' : 'down'}${item.tag}` : 'toggle')}
			{#if item.type === 'line'}
				{@const l = item.line}
				<div class="lw" class:under={l.under} data-line={l.key}>
					<div class="ln">
						<span class="tag" class:on={l.on}>{l.tag}</span>
						<div class="bo">
							<div class="t" class:mu={l.muted} class:sm={l.small}>{l.title}</div>
							{#if l.meta}<div class="m">{l.meta}</div>{/if}
							{#each l.states as s, n (n)}
								<div class="s">
									<span class="l" class:q={s.quiet}>{s.l}</span>
									{#if s.r}<span class="r" class:al={s.alert}>{s.r}</span>{/if}
								</div>
							{/each}
						</div>
						{#if l.cells.length}
							<div class="cs" class:many={l.cells.length > 1}>
								{#each l.cells as c (c.key)}{@render cell(c)}{/each}
							</div>
						{/if}
					</div>
					{#if l.cells.length > 1}
						<div class="drop">
							{#each l.cells as c (c.key)}{@render cell(c)}{/each}
						</div>
					{/if}
				</div>
			{:else if item.type === 'fold'}
				<button type="button" class="fold" class:ink={item.ink} onclick={onexpand}>
					<span class="ft">{item.tag}</span>
					<span class="fb">{item.above ? '↑' : '↓'} {item.word}</span>
					<span class="go">SHOW</span>
				</button>
			{:else}
				<button type="button" class="fold" onclick={onexpand}>
					<span class="ft">ALL {item.count}</span>
					<span class="fb">{item.expanded ? '↑' : '↓'} SEASONS</span>
					<span class="go">{item.expanded ? 'HIDE' : 'SHOW'}</span>
				</button>
			{/if}
		{/each}
	</div>
</div>

<style>
	/* LISTS, transcribed from the design (the 440 panel; phone 390, TV, tablet
	   portrait): its own literals, colours from tokens. None of it is on a spacing ladder (the theme has none) and it
	   isn't meant to be: tests/series-lists-frame.e2e.ts pins it. */
	.lists-row {
		/* The 440 panel and desktop. */
		--tw: 64px;
		--lh: 56px;
		--ts: 14px;
		--ms: 12px;
		--cs: 13px;
		--fs: 12px;
		/* A muted title on an anime's line, a size down (`.t.mu.sm`). */
		--tms: 13px;
		--strip-pad: 16px;
		--bo-pad: 10px 12px;
		--drop-h: 48px;
		display: flex;
		align-items: stretch;
		border-bottom: 1px solid var(--line-1);
	}
	.lab {
		display: none;
		width: var(--label-w, 120px);
		flex-shrink: 0;
		align-items: flex-start;
		padding: 18px 0 0 var(--pad);
		border-right: 1px solid var(--line-1);
		font: 500 12px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.lists {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.strip {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		min-height: 36px;
		padding: 0 var(--strip-pad);
		border-bottom: 1px solid var(--line-1);
		font: 500 12px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.note {
		font-weight: 400;
		letter-spacing: 0.02em;
		color: var(--text-1);
		text-align: right;
	}
	.lw {
		border-bottom: 1px solid var(--line-subtle);
	}
	.lw:last-child {
		border-bottom: 0;
	}
	/* Ranobe's one line under an anime's seasons. */
	.lw.under {
		border-top: 1px solid var(--line-1);
	}
	.ln {
		display: flex;
		align-items: stretch;
		min-height: var(--lh);
	}
	.tag {
		width: var(--tw);
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		border-right: 1px solid var(--line-1);
		font: 500 11px var(--font-mono);
		letter-spacing: 0.04em;
		color: var(--text-2);
	}
	/* The season being watched: inverted, the house mark for "active". */
	.tag.on {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.bo {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 4px;
		padding: var(--bo-pad);
	}
	.t {
		font: 500 var(--ts) / 1.3 var(--font-sans);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.t.mu {
		color: var(--text-2);
	}
	.t.sm {
		font-size: var(--tms);
	}
	.m {
		font: 400 var(--ms) / 1.35 var(--font-mono);
		color: var(--text-2);
		text-wrap: pretty;
	}
	.s {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: baseline;
		gap: 2px 12px;
		font: 400 var(--ms) / 1.35 var(--font-mono);
	}
	.s .l {
		font-weight: 500;
		color: var(--text-1);
	}
	.s .l.q {
		font-weight: 400;
		color: var(--text-2);
	}
	.s .r {
		color: var(--text-2);
	}
	.s .r.al {
		color: var(--text-1);
	}
	.cs {
		display: flex;
	}
	.cf {
		display: flex;
	}
	.c {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 64px;
		padding: 0 14px;
		border: 0;
		border-left: 1px solid var(--line-1);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 var(--cs) var(--font-mono);
		letter-spacing: 0.04em;
		white-space: nowrap;
		text-decoration: none;
		cursor: pointer;
	}
	.c.acc {
		background: var(--accent);
		color: var(--on-accent);
	}
	.c.dim {
		opacity: 0.35;
		cursor: default;
	}
	.drop {
		display: grid;
		grid-auto-flow: column;
		grid-auto-columns: minmax(0, 1fr);
		min-height: var(--drop-h);
		border-top: 1px solid var(--line-subtle);
	}
	.drop .c {
		border-left: 0;
		border-right: 1px solid var(--line-1);
	}
	.drop .cf .c {
		flex: 1;
	}
	.drop > :last-child,
	.drop > :last-child .c {
		border-right: 0;
	}
	/* Two or more cells drop under the line (the rule, everywhere but the tablet
	   in portrait); one stays at its end. */
	.cs.many {
		display: none;
	}
	.fold {
		display: flex;
		align-items: stretch;
		width: 100%;
		min-height: 40px;
		padding: 0;
		border: 0;
		border-bottom: 1px solid var(--line-subtle);
		border-radius: 0;
		background: transparent;
		color: var(--text-2);
		font: 500 var(--fs) var(--font-mono);
		letter-spacing: 0.04em;
		text-align: left;
		cursor: pointer;
	}
	.fold.ink .fb {
		color: var(--text-1);
	}
	.ft {
		width: var(--tw);
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		border-right: 1px solid var(--line-1);
		font-size: 11px;
	}
	.fb {
		flex: 1;
		display: flex;
		align-items: center;
		padding: 0 12px;
	}
	.go {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 64px;
		border-left: 1px solid var(--line-1);
		color: var(--text-1);
	}
	/* Phone portrait (390): line 52, title 13, as the season lines were. The
	   tag is 60, not the narrow layouts' 56: those only ever put S3 or RNB in
	   it, and ANILIST, the phone's tag, does not fit 56. */
	@media (max-width: 599px) {
		.lists-row {
			--tw: 60px;
			--lh: 52px;
			--ts: 13px;
			--bo-pad: 9px 10px 9px 12px;
			--drop-h: 52px;
		}
	}
	/* The tablet in portrait: room for the label column, LISTS at the left
	   like the other rows, and every cell at its line's end, even two. The
	   strip only stays to say why, when there is something to say. */
	@media (min-width: 600px) and (max-width: 1023px) and (not ((pointer: none) and (min-width: 900px))) {
		.lists-row {
			--ts: 15px;
			--tms: 15px;
			--ms: 13px;
			--cs: 14px;
			--strip-pad: 24px;
			--bo-pad: 9px 10px 9px 12px;
		}
		.lab {
			display: flex;
		}
		.strip {
			display: none;
		}
		.strip.noted {
			display: flex;
			justify-content: flex-end;
		}
		.strip-l {
			display: none;
		}
		.cs.many {
			display: flex;
		}
		.drop {
			display: none;
		}
	}
	/* The TV's 352px column: text 15, lines 56, and a line drops its meta,
	   which is one OK away in EDIT. */
	@media (pointer: none) and (min-width: 900px) {
		.lists-row {
			--tw: 56px;
			--lh: 56px;
			--ts: 16px;
			--tms: 16px;
			--ms: 15px;
			--cs: 15px;
			--fs: 15px;
			--bo-pad: 9px 10px 9px 12px;
		}
		.m {
			display: none;
		}
	}
</style>
