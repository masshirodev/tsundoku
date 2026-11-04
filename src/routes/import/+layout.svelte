<script lang="ts">
	/**
	 * IMPORT A BACKUP's screens (c438; doc/handoffs/import-backup, `im.css`):
	 * the pick screen, a file's preview, progress and result, and the IMPORT
	 * LOG share one set of parts. They are the handoff's classes, transcribed
	 * on the app's tokens (every colour is one: reconcile-tokens found 8 of 8)
	 * and its hand-set lengths kept as literals, since the theme declares no
	 * spacing ladder. Scoped under `.imp` so nothing leaks to other screens.
	 */
	let { children } = $props();
</script>

<div class="imp">{@render children()}</div>

<style>
	.imp {
		display: flex;
		flex-direction: column;
		min-height: 100%;
		color: var(--text-1);
		font-family: var(--font-sans);
	}
	.imp :global(.bar-title) {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: flex-start;
		text-align: left;
		gap: 3px;
		padding: 0 20px;
	}
	.imp :global(.bar-title .t) {
		margin: 0;
		font: 500 14px var(--font-mono);
	}
	.imp :global(.bar-title .s) {
		font: 400 12px var(--font-mono);
		color: var(--text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.imp :global(.cellx) {
		display: flex;
		align-items: center;
		gap: 12px;
		height: 100%;
		padding: 0 24px;
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		text-decoration: none;
		white-space: nowrap;
	}
	.imp :global(.pg) {
		display: flex;
		flex-direction: column;
		padding: 40px 64px 48px;
		max-width: 1040px;
	}
	.imp :global(.pg h1) {
		margin: 10px 0 0;
		font: 500 34px/1.2 var(--font-sans);
	}
	.imp :global(.lede) {
		margin: 12px 0 0;
		font: 400 18px/1.5 var(--font-sans);
		color: var(--text-prose);
		max-width: 700px;
		text-wrap: pretty;
	}
	.imp :global(.prose) {
		margin: 0;
		font: 400 16px/1.55 var(--font-sans);
		color: var(--text-prose);
		max-width: 680px;
		text-wrap: pretty;
	}
	.imp :global(.prose b) {
		color: var(--text-1);
		font-weight: 500;
	}
	.imp :global(.lab) {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 12px;
		padding: 36px 0 12px;
		font: 500 13px/1.2 var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.imp :global(.lab.first) {
		padding-top: 0;
	}
	.imp :global(.lab .r) {
		display: inline;
		min-height: 0;
		white-space: nowrap;
	}
	.imp :global(.k) {
		font: 500 12px/1.2 var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.imp :global(.note) {
		margin-top: 10px;
		font: 400 12px/1.5 var(--font-mono);
		color: var(--text-2);
	}
	.imp :global(.btn) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 10px;
		height: 48px;
		padding: 0 20px;
		border: 1px solid var(--line-2);
		background: transparent;
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		text-decoration: none;
		white-space: nowrap;
		cursor: pointer;
	}
	.imp :global(.btn.primary) {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--on-accent);
	}
	.imp :global(.btn.lg) {
		height: 56px;
		padding: 0 28px;
		font-size: 15px;
		letter-spacing: 0.04em;
	}
	.imp :global(.blk) {
		display: flex;
		flex-direction: column;
		border: var(--hairline);
	}
	.imp :global(.blk > * + *) {
		border-top: var(--hairline);
	}
	.imp :global(.r) {
		display: flex;
		align-items: stretch;
		min-height: 64px;
	}
	.imp :global(.r .tx) {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 5px;
		padding: 12px 20px;
	}
	.imp :global(.r .tx .a) {
		font: 500 16px/1.3 var(--font-sans);
		overflow-wrap: anywhere;
	}
	.imp :global(.r .tx .am) {
		font: 500 14px/1.3 var(--font-mono);
		overflow-wrap: anywhere;
	}
	.imp :global(.r .tx .b) {
		font: 400 13px/1.4 var(--font-mono);
		color: var(--text-2);
		overflow-wrap: anywhere;
	}
	.imp :global(.r .cl) {
		display: flex;
		align-items: center;
		padding: 0 20px;
		border-left: var(--hairline);
		font: 400 13px var(--font-mono);
		color: var(--text-2);
		white-space: nowrap;
	}
	.imp :global(.r .ac) {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 120px;
		padding: 0 22px;
		border: 0;
		border-left: var(--hairline);
		background: transparent;
		font: 500 14px var(--font-mono);
		color: var(--text-1);
		text-decoration: none;
		white-space: nowrap;
		cursor: pointer;
	}
	.imp :global(.r .ac.go) {
		color: var(--accent);
	}
	.imp :global(.r .ac.fill) {
		background: var(--accent);
		color: var(--on-accent);
	}
	.imp :global(.r .ac.inv) {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.imp :global(.r .ac.q) {
		color: var(--text-2);
	}
	.imp :global(.r.ruled) {
		box-shadow: inset 3px 0 0 var(--text-1);
	}
	.imp :global(.r.dimmed .tx) {
		opacity: 0.4;
	}
	.imp :global(.nums) {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 1px;
		margin-top: 24px;
		background: var(--line-1);
		border: var(--hairline);
	}
	.imp :global(.nums > div) {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 18px 20px 20px;
		background: var(--surface-page);
	}
	.imp :global(.nums .v) {
		font: 500 32px/1 var(--font-mono);
	}
	.imp :global(.nums .v.acc) {
		color: var(--accent);
	}
	.imp :global(.nums .t) {
		font: 500 12px/1.3 var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.imp :global(.prog) {
		height: 4px;
		background: var(--line-2);
	}
	.imp :global(.prog i) {
		display: block;
		height: 4px;
		background: var(--accent);
	}
	.imp :global(.prog.ink i) {
		background: var(--text-1);
	}
	.imp :global(.prog.wait) {
		background: repeating-linear-gradient(90deg, var(--line-2) 0 10px, transparent 10px 16px);
	}
	.imp :global(.band) {
		flex-shrink: 0;
		display: flex;
		align-items: stretch;
		min-height: 60px;
		background: var(--surface-panel);
	}
	.imp :global(.band.top) {
		border-top: var(--rule-strong);
	}
	.imp :global(.band .bt) {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 4px;
		padding: 10px 20px;
	}
	.imp :global(.band .bt .a) {
		font: 500 14px var(--font-mono);
	}
	.imp :global(.band .bt .b) {
		font: 400 13px/1.4 var(--font-mono);
		color: var(--text-2);
	}
	.imp :global(.band .bc) {
		display: flex;
		align-items: center;
		padding: 0 22px;
		border: 0;
		border-left: var(--hairline);
		background: transparent;
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		text-decoration: none;
		white-space: nowrap;
		cursor: pointer;
	}
	.imp :global(.band .bc.fill) {
		background: var(--accent);
		color: var(--on-accent);
		border-left: 0;
	}
	.imp :global(.confirm) {
		position: sticky;
		bottom: 0;
		flex-shrink: 0;
		display: flex;
		align-items: stretch;
		height: 72px;
		margin-top: auto;
		border-top: var(--rule-strong);
		background: var(--surface-page);
	}
	.imp :global(.confirm .sum) {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 4px;
		padding: 0 24px;
	}
	.imp :global(.confirm .sum .a) {
		font: 500 14px var(--font-mono);
	}
	.imp :global(.confirm .sum .b) {
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}
	.imp :global(.confirm .c) {
		display: flex;
		align-items: center;
		padding: 0 28px;
		border: 0;
		border-left: var(--hairline);
		background: transparent;
		font: 500 15px var(--font-mono);
		letter-spacing: 0.04em;
		color: var(--text-1);
		text-decoration: none;
		white-space: nowrap;
		cursor: pointer;
	}
	.imp :global(.confirm .c.go) {
		background: var(--accent);
		color: var(--on-accent);
		border-left: 0;
	}
	/* The phone (Import-Phone-*: 390 wide), as the handoff's `.phone` block draws it. */
	@media (max-width: 599px) {
		.imp :global(.cellx) {
			padding: 0 16px;
			font-size: 13px;
		}
		.imp :global(.bar-title) {
			padding: 0 14px;
		}
		.imp :global(.pg) {
			padding: 24px 16px 32px;
		}
		.imp :global(.pg h1) {
			font-size: 26px;
		}
		.imp :global(.lede) {
			font-size: 16px;
		}
		.imp :global(.prose) {
			font-size: 15px;
		}
		.imp :global(.lab) {
			padding: 28px 0 10px;
			font-size: 12px;
		}
		.imp :global(.lab.first) {
			padding-top: 0;
		}
		.imp :global(.nums) {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.imp :global(.nums .v) {
			font-size: 26px;
		}
		.imp :global(.r .tx) {
			padding: 10px 14px;
		}
		.imp :global(.r .tx .a) {
			font-size: 15px;
		}
		.imp :global(.r .tx .b) {
			font-size: 12px;
		}
		.imp :global(.r .ac) {
			min-width: 0;
			padding: 0 14px;
			font-size: 13px;
		}
		.imp :global(.r .cl) {
			white-space: normal;
		}
		/* A cell the phone's boards leave out (SKIP: NO NEW CHAPTERS, THEIR FILES STAYED…). */
		.imp :global(.r .cl.wide),
		.imp :global(.wide) {
			display: none;
		}
		.imp :global(.confirm) {
			height: auto;
			flex-direction: column;
		}
		.imp :global(.confirm .sum) {
			padding: 12px 16px;
		}
		.imp :global(.confirm .c) {
			justify-content: center;
			height: 56px;
			border-left: 0;
			border-top: var(--hairline);
		}
	}
</style>
