import type { Page } from '@playwright/test';

/**
 * The fonts Chromium actually drew a node's text with, from the
 * DevTools protocol's CSS.getPlatformFontsForNode. A computed `font-family`
 * is only the stack asked for: a face whose file never loaded falls through
 * to the next family without changing it, so only the drawn font says whether
 * a self-hosted face reached the page. Chromium only.
 */
export async function drawnFonts(
	page: Page,
	selector: string
): Promise<{ familyName: string; isCustomFont: boolean; glyphCount: number }[]> {
	const cdp = await page.context().newCDPSession(page);
	try {
		await cdp.send('DOM.enable');
		await cdp.send('CSS.enable');
		const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
		const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
		if (!nodeId) throw new Error(`drawnFonts: nothing matches ${selector}`);
		const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
		return fonts;
	} finally {
		await cdp.detach();
	}
}
