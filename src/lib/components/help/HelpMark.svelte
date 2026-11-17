<!--
	The "?" (doc/HELP.md): a 20 px square after a row's or a section's label.
	The label cell around it is the button; this is only its mark, so it's
	hidden from assistive tech, which reads the button's own name ("Help:
	Wi-Fi").
-->
<span class="mark" aria-hidden="true">?</span>

<style>
	.mark {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 20px;
		height: 20px;
		box-sizing: border-box;
		border: 1px solid var(--line-2);
		font: 500 12px var(--font-mono);
		letter-spacing: 0;
	}
	:global(:is(button, a):active) > .mark,
	:global([aria-expanded='true']) > .mark {
		border-color: currentColor;
	}
</style>
