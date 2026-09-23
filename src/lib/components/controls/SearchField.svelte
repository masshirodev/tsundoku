<script lang="ts">
	/**
	 * The search input. The leading `/` is a prompt glyph drawn by the field,
	 * not part of the value -- so the reveal command is typed as `/reveal`,
	 * and a query for "isekai" is typed as `isekai`.
	 */
	let {
		value = $bindable(''),
		name = 'q',
		placeholder = 'search title, tag, artist',
		autofocus = false,
		input = $bindable<HTMLInputElement | null>(null)
	}: {
		value?: string;
		name?: string;
		placeholder?: string;
		autofocus?: boolean;
		input?: HTMLInputElement | null;
	} = $props();

	$effect(() => {
		if (autofocus) input?.focus();
	});
</script>

<label class="field">
	<span class="prompt" aria-hidden="true">/</span>
	<input
		bind:this={input}
		bind:value
		{name}
		{placeholder}
		type="search"
		autocomplete="off"
		autocapitalize="off"
		spellcheck="false"
		enterkeyhint="search"
		aria-label="Search"
	/>
</label>

<style>
	.field {
		flex: 1;
		display: flex;
		align-items: center;
		/* One mono space, so the prompt reads as "/ isekai". */
		gap: 1ch;
		padding: 0 18px;
		min-width: 0;
		font: 500 18px var(--font-mono);
	}
	.prompt {
		color: var(--text-1);
	}
	input {
		flex: 1;
		min-width: 0;
		background: transparent;
		border: 0;
		outline: none;
		color: var(--text-1);
		caret-color: var(--accent);
		font: inherit;
		padding: 0;
	}
	input::placeholder {
		color: var(--text-2);
		font-weight: 400;
	}
	input::-webkit-search-cancel-button {
		display: none;
	}
</style>
