import type { Page } from '@playwright/test';
import { test as base, expect } from '../fixtures';

/**
 * The page has hydrated: SvelteKit's root component draws its route
 * announcer (`#svelte-announcer`) from its own `onMount`, which runs after
 * every component under it has mounted, so the element is there exactly when
 * the whole tree's handlers are (doc/TESTING.md, "Waiting on the page's own
 * state"; c439).
 *
 * `networkidle` alone is a guess at the same moment: 500 ms with no request.
 * On a loaded box the last module arrives and the CPU then takes longer than
 * that to run it, so the guess comes true before hydration does, and a tap
 * lands on server-rendered markup that has no handler yet. That was the
 * suite's load flake, a different spec each run.
 *
 * A document that isn't SvelteKit's (an API's JSON, an image, a page served
 * with script off) never draws the announcer, so it isn't waited for.
 */
export async function hydrated(page: Page): Promise<void> {
	await page.waitForLoadState('load');
	await page.waitForFunction(
		() =>
			!!document.getElementById('svelte-announcer') ||
			!Object.keys(window).some((k) => k.startsWith('__sveltekit_'))
	);
}

/**
 * `test` from `tests/fixtures.ts`, whose `page.goto` waits for the network to
 * settle, with every full document load also waiting for hydration: `goto`,
 * `reload`, `goBack` and `goForward`. The specs this slot owns import it
 * (c439); `tests/fixtures.ts` itself is nobody's this wave, so the same wait
 * there is a Gap in doc/handoff-notes/e2e.md.
 */
export const test = base.extend({
	page: async ({ page }, use) => {
		for (const name of ['goto', 'reload', 'goBack', 'goForward'] as const) {
			const navigate = page[name].bind(page) as (...a: unknown[]) => ReturnType<Page['reload']>;
			(page as unknown as Record<string, unknown>)[name] = async (...args: unknown[]) => {
				const res = await navigate(...args);
				await hydrated(page);
				return res;
			};
		}
		await use(page);
	}
});

export { expect };
export { readerReady, screenSettled } from '../fixtures';
