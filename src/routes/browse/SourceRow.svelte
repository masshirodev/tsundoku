<script lang="ts">
	import { resolve } from '$app/paths';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { page } from '$app/state';
	import { coverPlaceholder } from '$lib/library/cover';
	import type { BrowseRow } from '$lib/server/engine/browse';

	/**
	 * A source in BROWSE's list and the empty search's offer: its icon, its
	 * name, one line, and → to its page. A source the engine refused is the
	 * house's failed row (a 3px ink rule, the reason in a word) and leads to
	 * EXTENSIONS. HIDDEN sits on the icon of a mostly-hidden source, which is
	 * only ever listed inside reveal.
	 *
	 * With `pin`, a PIN cell sits right of the link behind its own hairline
	 * (c1142): a tap on the name still opens the source. Pinned is a filled
	 * accent square and PINNED in ink; unpinned an outlined square and PIN.
	 */
	let {
		r,
		meta,
		ticked = '',
		pin = false
	}: {
		r: BrowseRow;
		meta: string;
		/** While selecting: how many of its series are ticked, `9 TICKED`, in ink. */
		ticked?: string;
		/** Draw the PIN cell (BROWSE's own list, not the empty search's offer). */
		pin?: boolean;
	} = $props();
	/** The action keeps the page's own query (`?kind=`), so a page without script comes back to it. */
	const pinAction = $derived(`${page.url.search ? `${page.url.search}&` : '?'}/pin`);
	/**
	 * A press keeps the focus on PIN: BROWSE draws again (01 — PINNED comes or
	 * goes), and a remote left on nothing has nowhere to go on from. If the
	 * pressed button was drawn anew, the focus goes to this source's first PIN.
	 */
	const keepFocus: SubmitFunction = ({ submitter }) => {
		const had = submitter instanceof HTMLElement && document.activeElement === submitter;
		return async ({ update }) => {
			await update({ reset: false });
			if (!had || (document.activeElement && document.activeElement !== document.body)) return;
			const again = submitter?.isConnected
				? (submitter as HTMLElement)
				: document.querySelector<HTMLElement>(`button[data-pin="${CSS.escape(r.id)}"]`);
			again?.focus();
		};
	};
	const hue = $derived([...r.id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 0));
	const m = $derived(meta);
	const extensionsHref = resolve('/browse/extensions');
</script>

{#if r.failed}
	<a class="row failed" href={extensionsHref}>
		<span class="main">
			<span class="icon" style:background={coverPlaceholder(hue)}></span>
			<span class="text">
				<span class="t">{r.label}</span>
				<span class="m"
					><span class="lead">FAILED TO LOAD · {r.failed.toUpperCase()}</span> · TRY AGAIN IN EXTENSIONS</span
				>
			</span>
		</span>
		<span class="go">EXTENSIONS →</span>
	</a>
{:else}
	<div class="pin-row" class:pinned={r.pinned}>
		<a class="row" href={resolve('/browse/[source]', { source: r.id })}>
			<span class="main">
				<span
					class="icon"
					style:background="center / cover no-repeat url({resolve('/api/browse/icon/[pkg]', {
						pkg: r.pkg
					})}), {coverPlaceholder(hue)}"
				>
					{#if r.mostlyHidden}<span class="hid">HIDDEN</span>{/if}
				</span>
				<span class="text">
					<span class="t">{r.label}</span>
					<span class="m"
						>{m}{#if ticked}{m ? ' · ' : ''}<span class="lead">{ticked}</span>{/if}</span
					>
				</span>
			</span>
			<span class="go" aria-hidden="true">→</span>
		</a>
		{#if pin}
			<form method="POST" action={pinAction} use:enhance={keepFocus} class="pin">
				<input type="hidden" name="source" value={r.id} />
				<input type="hidden" name="to" value={r.pinned ? '0' : '1'} />
				<!-- A TV's second stop on the row: → reaches it, OK toggles it, the mark drawn inside. -->
				<button
					data-focus-mark="in"
					data-pin={r.id}
					aria-pressed={r.pinned}
					aria-label="{r.pinned ? 'Pinned' : 'Pin'} {r.label}"
					><span class="sq" aria-hidden="true"></span>{r.pinned ? 'PINNED' : 'PIN'}</button
				>
			</form>
		{/if}
	</div>
{/if}

<style>
	.pin-row {
		display: flex;
		border-bottom: var(--hairline);
	}
	.pin-row .row {
		flex: 1;
		min-width: 0;
		border-bottom: 0;
	}
	.pin {
		display: flex;
		flex-shrink: 0;
		width: 104px;
		border-left: var(--hairline);
	}
	.pin button {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		border: 0;
		background: none;
		color: var(--text-2);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
		cursor: pointer;
	}
	.pinned .pin button {
		color: var(--text-1);
	}
	.sq {
		width: 9px;
		height: 9px;
		box-sizing: border-box;
		border: 1px solid currentColor;
	}
	.pinned .sq {
		border-color: var(--accent);
		background: var(--accent);
	}
	@media (max-width: 599px) {
		.pin {
			width: 76px;
		}
		.pin button {
			flex-direction: column;
			gap: 6px;
			font-size: 11px;
		}
	}
	.row {
		display: flex;
		align-items: stretch;
		min-height: 64px;
		border-bottom: var(--hairline);
		color: var(--text-1);
		text-decoration: none;
	}
	.row:active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.row.failed {
		box-shadow: inset 3px 0 0 var(--text-1);
	}
	.main {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 10px var(--pad);
	}
	.icon {
		position: relative;
		flex-shrink: 0;
		width: 40px;
		height: 40px;
		box-sizing: border-box;
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
	.t,
	.m {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.t {
		font: 500 16px/1.3 var(--font-sans);
	}
	.m {
		font: 400 13px/1.3 var(--font-mono);
		color: var(--text-2);
	}
	.lead {
		color: var(--text-1);
		font-weight: 500;
	}
	.row:active .m,
	.row:active .lead {
		color: inherit;
	}
	.go {
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
		white-space: nowrap;
	}
</style>
