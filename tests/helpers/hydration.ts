import type { Page } from '@playwright/test';

/**
 * The page has hydrated: SvelteKit's root component draws its route
 * announcer (`#svelte-announcer`) from its own `onMount`, which runs after
 * every component under it has mounted, so the element is there exactly when
 * the whole tree's handlers are (doc/TESTING.md, "E2E specs": "Network quiet
 * is a guess at hydration").
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
