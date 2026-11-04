import type { Page } from '@playwright/test';
import { test as base, expect } from '../fixtures';
import { hydrated } from './hydration';

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

export { expect, hydrated };
export { readerReady, screenSettled } from '../fixtures';
