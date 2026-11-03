/**
 * Picture-in-picture with tsundoku's own subtitles (doc/ANIME.md, "The
 * player"; card c388). tsundoku draws subtitles over the picture itself, and
 * a video's own picture-in-picture moves only the <video>, so the drawn
 * subtitles stayed on the page. Two paths:
 *
 * - **Document Picture-in-Picture** (`documentPictureInPicture.requestWindow`,
 *   Chrome and Edge on a desktop, and Firefox 155): the player's picture layer -- the <video>,
 *   the drawn subtitles, the dim -- is moved into the floating window and back
 *   on close, so the subtitles keep tsundoku's face, size and placement.
 *   Svelte's scoped styles live in the page's stylesheets, which a node moved
 *   into another document no longer sees: they are copied in (`copyStyles`).
 * - **A native track** of the same WebVTT, `<track kind="subtitles">`, for a
 *   video's own picture-in-picture, which moves the <video> alone (the
 *   browser's own PiP button anywhere; the PIP cell where Document PiP is
 *   missing). It is `showing` all the time, so a PiP window has cues to read
 *   whether or not the browser tells the page it opened, and the page draws
 *   those cues invisibly (`video.cueless::cue`, transparent), tsundoku's own
 *   line being the only one on the page. While the browser says its PiP has
 *   the picture (`enterpictureinpicture` to `leavepictureinpicture`) the
 *   cues are drawn plainly, in case a PiP window takes the page's cue style.
 *   Whether a browser's own PiP window draws the track is **not checked**
 *   here (doc/ANIME.md, "The player"; doc/handoff-notes/anime.md, wave 18,
 *   Gaps): Playwright opens one but cannot look into it. Only the page's
 *   side is tested, in Chromium and Firefox.
 */

/** The part of the Document Picture-in-Picture API the player uses. */
export type DocumentPip = {
	requestWindow(o?: { width?: number; height?: number }): Promise<Window>;
	window: Window | null;
};

/** The browser's Document Picture-in-Picture, where it has one. */
export const documentPip = (w: Window = window): DocumentPip | null =>
	(w as Window & { documentPictureInPicture?: DocumentPip }).documentPictureInPicture ?? null;

/** Whether a PIP cell has anything to open: either path. */
export const canPip = (w: Window = window): boolean =>
	!!documentPip(w) ||
	!!(w.document as Document & { pictureInPictureEnabled?: boolean }).pictureInPictureEnabled;

/**
 * The floating window's own rules: no page around the picture, so the
 * picture layer fills it, black where the video doesn't. There are no
 * controls in it, so the subtitles sit where the page puts them while the
 * controls are hidden (`.subs`, 7 % from the bottom), and never rise.
 */
export const PIP_CSS = `html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
body { position: relative; }`;

/**
 * Copies the page's styles into the floating window's document: every rule
 * of every stylesheet the page can read, a <link> for one it can't (another
 * origin's), and the root element's classes and data attributes (the theme).
 */
export function copyStyles(from: Document, to: Document): void {
	for (const sheet of Array.from(from.styleSheets)) {
		try {
			const css = Array.from(sheet.cssRules)
				.map((r) => r.cssText)
				.join('\n');
			const style = to.createElement('style');
			style.textContent = css;
			to.head.append(style);
		} catch {
			if (!sheet.href) continue;
			const link = to.createElement('link');
			link.rel = 'stylesheet';
			link.href = sheet.href;
			to.head.append(link);
		}
	}
	const extra = to.createElement('style');
	extra.textContent = PIP_CSS;
	to.head.append(extra);
	to.documentElement.className = from.documentElement.className;
	for (const a of Array.from(from.documentElement.attributes))
		if (a.name.startsWith('data-') || a.name === 'lang')
			to.documentElement.setAttribute(a.name, a.value);
}

/**
 * Moves the picture layer into the floating window, and [back] puts it where
 * it was: first in the player, as the markup has it. Done outside Svelte on
 * purpose, and safe: the layer is one static element Svelte never re-inserts
 * (its blocks keep updating inside it, wherever it is), and the player puts it
 * back before it is destroyed (NEXT, leaving the page), so Svelte never
 * removes a node that isn't where it left it.
 */
export function moveInto(w: Window, layer: HTMLElement): void {
	w.document.body.append(layer);
}
export function moveBack(player: HTMLElement, layer: HTMLElement): void {
	if (layer.parentElement !== player) player.prepend(layer);
}

/** A track's `srclang`: its code in the lower case BCP 47 writes it in. */
export const srclang = (lang: string) => lang.toLowerCase();
