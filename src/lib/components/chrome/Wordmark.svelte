<script lang="ts">
	/**
	 * The typeset wordmark. There is no logo, and none is to be drawn. The
	 * sidebar sets it at 17px; everywhere else it is --type-wordmark's 18px.
	 */
	let { jp = true, size = 18 }: { jp?: boolean; size?: number } = $props();
</script>

<span class="wordmark">
	<span class="latin" style:font-size="{size}px">TSUNDOKU</span>
	{#if jp}<span class="jp" lang="ja">積ん読</span>{/if}
</span>

<style>
	.wordmark {
		display: inline-flex;
		align-items: center;
		gap: 12px;
		white-space: nowrap;
	}
	.latin {
		font: var(--type-wordmark);
		letter-spacing: 0.02em;
	}
	.jp {
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}
</style>
