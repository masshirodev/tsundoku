/**
 * Keep a block of a vertical strip out of the pad's reach while it is off
 * screen (doc/READER.md, "On a TV and on a remote"). The focus layer weighs
 * every focusable in the page, on screen or not, so with a TV's chrome up over
 * a strip, ↓ from the bottom row would find the end page's LIBRARY at the foot
 * of the chapter and scroll thousands of pixels to it. While `active`
 * (a TV with the chrome up) and the block is outside the viewport, it carries
 * `data-focus-skip`; once it is on screen it is an arrow stop as before, which
 * is how a remote reaches the end page's cells.
 */
export function skipOffscreen(node: HTMLElement, active: boolean) {
	let on = active;
	let seen = false;
	const apply = () => {
		if (on && !seen) node.setAttribute('data-focus-skip', '');
		else node.removeAttribute('data-focus-skip');
	};
	const io = new IntersectionObserver((entries) => {
		for (const e of entries) seen = e.isIntersecting;
		apply();
	});
	io.observe(node);
	apply();
	return {
		update(next: boolean) {
			on = next;
			apply();
		},
		destroy() {
			io.disconnect();
		}
	};
}
