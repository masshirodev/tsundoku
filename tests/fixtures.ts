import { test as base, expect, type Page } from '@playwright/test';
import { hydrated } from './helpers/hydration';

/**
 * Most e2e specs import `test` from here. How many, and which do not, is the
 * block `yarn run e2e:table` writes into doc/TESTING.md ("E2E specs", between
 * the `e2e-fixtures` markers), which `tests/e2e-table.spec.ts` checks; no
 * count is typed here, since every new spec file would falsify it. Every full
 * document load such a test makes
 * -- `page.goto`, `page.reload`, `page.goBack` and `page.goForward` -- waits
 * for the page to have hydrated (`hydrated()`, `tests/helpers/hydration.ts`),
 * and `goto` waits for the network to go quiet first. SvelteKit hydrates
 * after `load`, and under the full parallel run a click can land on
 * server-rendered markup whose handlers don't exist yet -- a tap that opens
 * nothing, a form that posts without JavaScript, an arrow key the focus
 * layer never sees.
 *
 * Network quiet alone is not enough: 500 ms
 * without a request is a guess at hydration, and on a loaded box the last
 * module arrives and then waits longer than that for the CPU. SvelteKit's
 * route announcer is the page's own mark (doc/TESTING.md, "E2E specs":
 * "Network quiet is a guess at hydration"). `tests/helpers/hydrated.ts` is
 * this `test` under another name.
 *
 * A spec that means to act before hydration, as a quick thumb does
 * (`browse-tags`, `filters-layout`, `library-top-bar`'s FILTER case), imports
 * `test` from `@playwright/test`. The others that do so only because nobody
 * moved them over are listed in that generated block, and get no wait at all.
 */
export const test = base.extend({
	page: async ({ page }, use) => {
		const goto = page.goto.bind(page);
		page.goto = async (url, options) => {
			const res = await goto(url, options);
			await page.waitForLoadState('networkidle');
			await hydrated(page);
			return res;
		};
		for (const name of ['reload', 'goBack', 'goForward'] as const) {
			const navigate = page[name].bind(page) as Page['reload'];
			page[name] = async (options) => {
				const res = await navigate(options);
				await hydrated(page);
				return res;
			};
		}
		await use(page);
	}
});

export { expect, hydrated };

/**
 * The reader is ready: its stylesheet has applied (the ground is true black).
 * A client-side navigation into it doesn't change the document, so no load
 * state waits for its CSS, and until it lands the stage isn't full-screen --
 * taps miss it and the controls aren't fixed yet.
 */
export async function readerReady(page: import('@playwright/test').Page): Promise<void> {
	await page.waitForURL(/\/read\/\d+/);
	await expect(page.locator('.reader')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
}

/**
 * The screen has come to rest: a client-side navigation slides the next
 * screen 40px in (doc/MOTION.md, "Screens"), and a measurement taken while it
 * moves reads fractions of a pixel. Call it before measuring a screen that
 * was navigated to.
 */
export async function screenSettled(page: import('@playwright/test').Page): Promise<void> {
	await page
		.locator('.main > .route-view > *')
		.first()
		.evaluate((n) =>
			Promise.all(n.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => undefined)))
		);
}
