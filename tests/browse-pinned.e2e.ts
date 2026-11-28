/**
 * Pinned sources (c1142; doc/DOWNLOADS.md, "Which of them a search asks first";
 * handoff `pinned-sources`): PIN on BROWSE's rows and a source's page, a
 * search that asks the pinned, ASK THEM for the rest, and the band that
 * offers to pin when nothing is. In the browse world, whose fake engine
 * records what it was asked. Every test unpins what it pinned, so the other
 * files' searches ask what they always did.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { ANIME_SOURCE, engineCalls, SOURCES } from './browse-world';

// The browse project's files share the fake engine and its call log: this
// file's searches carry words no other file searches for.
const Q = 'pinword';
const searchCalls = async (q = Q) =>
	(await engineCalls()).filter((c) => c.method.startsWith('getSearch') && c.search === q);
const asks = (page: Page) => page.getByRole('navigation', { name: 'Asks' });
const sourceTabs = (page: Page) => page.getByRole('navigation', { name: 'Sources' });

/**
 * Unpins every source BROWSE lists as pinned, by its own PIN cells. A pinned
 * source shows twice (01 — PINNED and its kind's section), so the count is
 * read again after each press rather than counted down.
 */
async function unpinEvery(page: Page) {
	await page.goto('/browse');
	const pinned = page.getByRole('button', { name: /^Pinned / });
	for (let i = 0; i < 20 && (await pinned.count()) > 0; i++) {
		const name = (await pinned.first().getAttribute('aria-label'))!;
		await pinned.first().click();
		await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
	}
	await expect(pinned).toHaveCount(0);
}

test.afterEach(async ({ page }) => {
	await unpinEvery(page);
});

test('PIN on BROWSE: 01 — PINNED, and a search asks the pinned, the rest on ASK THEM', async ({
	page
}) => {
	await unpinEvery(page);
	await page.goto('/browse');
	const pin = page.getByRole('button', { name: `Pin ${SOURCES.open.name}` }).first();
	await pin.click();
	// 01 — PINNED leads BROWSE, the source marked there and in its kind's section.
	await expect(page.locator('.label').first()).toContainText('01 — PINNED');
	await expect(page.locator('.label').first()).toContainText('A SEARCH ASKS THESE · 1');
	// Every copy of its row is marked: PINNED's, its kind's, and RECENT's when
	// an earlier case browsed it.
	await expect(
		page
			.locator('.rows')
			.first()
			.getByRole('button', { name: `Pinned ${SOURCES.open.name}` })
	).toBeVisible();
	await expect(page.getByRole('button', { name: `Pin ${SOURCES.open.name}` })).toHaveCount(0);

	// The search asks the one pinned source, and says what it didn't ask.
	const before = (await searchCalls()).length;
	await page.goto(`/downloads/search?q=${Q}`);
	await expect(asks(page).getByRole('link', { name: /^PINNED 1/ })).toHaveClass(/\bon\b/);
	await expect(page.locator('.label').first()).toContainText('01 — ASKED 1 PINNED · 1 ANSWERED');
	await expect(sourceTabs(page).getByRole('link')).toHaveText([
		/^ALL/,
		new RegExp(`^${SOURCES.open.name}`, 'i')
	]);
	await expect(page.locator('a.hit', { hasText: 'Filtered One' }).first()).toBeVisible();
	const asked = (await searchCalls()).slice(before).map((c) => c.sourceId);
	expect(asked).toEqual([SOURCES.open.id]);
	const askRest = page.locator('.ask-rest');
	await expect(askRest).toContainText(/MORE SOURCES? NOT ASKED/);
	await expect(askRest).toContainText('WHAT IS HERE STAYS · THEIR RESULTS FILL IN BELOW');

	// ASK THEM: the rest under 02, the pinned's answer kept, not asked again.
	const beforeRest = (await searchCalls()).length;
	await askRest.getByRole('link', { name: 'ASK THEM →' }).click();
	await page.waitForURL(/all=1/);
	await expect(page.locator('.label.rest-label')).toContainText(/^02 — THE OTHER \d+/);
	// The anime source's one hit (the fake's `getSearchAnime`), from 02.
	await expect(page.locator('a.hit', { hasText: 'Moonlit Search Hit' })).toHaveCount(1);
	await expect(asks(page).getByRole('link', { name: /^ALL SOURCES/ })).toHaveClass(/\bon\b/);
	const rest = (await searchCalls()).slice(beforeRest).map((c) => c.sourceId);
	expect(rest).not.toContain(SOURCES.open.id);
	expect(rest).toContain(ANIME_SOURCE.id);

	// A reload keeps ASK THEM, and asks nothing again.
	const beforeReload = (await searchCalls()).length;
	await page.reload();
	await expect(page.locator('.label.rest-label')).toBeVisible();
	await expect(page.getByText(/STILL ASKING/)).toHaveCount(0);
	expect((await searchCalls()).slice(beforeReload)).toEqual([]);

	// The next search starts at the pinned again.
	const Q2 = 'pinword2';
	const beforeNext = (await searchCalls(Q2)).length;
	await page.getByRole('searchbox').fill(Q2);
	await page.getByRole('searchbox').press('Enter');
	await page.waitForURL((u) => u.searchParams.get('q') === Q2 && !u.searchParams.has('all'));
	await expect(asks(page).getByRole('link', { name: /^PINNED 1/ })).toHaveClass(/\bon\b/);
	await expect(page.locator('.label').first()).toContainText('01 — ASKED 1 PINNED');
	expect((await searchCalls(Q2)).slice(beforeNext).map((c) => c.sourceId)).toEqual([
		SOURCES.open.id
	]);
});

test('nothing pinned: the band says what was asked, and one press pins them', async ({ page }) => {
	await unpinEvery(page);
	await page.goto('/downloads/search?q=pinword3');
	const band = page.locator('.band');
	await expect(band).toContainText(/NOTHING PINNED/);
	const press = band.getByRole('button', { name: /^PIN / });
	await expect(press).toBeVisible();
	const label = (await press.textContent())!.trim();
	await press.click();
	// Pinned now: the band goes, and the search asks the pinned.
	await expect(band).toHaveCount(0);
	await expect(asks(page).getByRole('link', { name: /^PINNED \d+/ })).toHaveClass(/\bon\b/);
	await expect(page.locator('.label').first()).toContainText(/01 — ASKED \d+ PINNED/);
	// What it pinned is what it named: one source by name, or a count.
	const m = /^PIN THE (\d+) /.exec(label);
	if (m) await expect(asks(page).getByRole('link', { name: `PINNED ${m[1]}` })).toBeVisible();
});

test('a source’s page pins it from the bar, says so in a band, and its settings agree', async ({
	page
}) => {
	await unpinEvery(page);
	await page.goto(`/browse/${SOURCES.open.id}`);
	await page.getByRole('button', { name: `Pin ${SOURCES.open.name}` }).click();
	await expect(page.locator('.pin-band')).toContainText('PINNED · A SEARCH OF THE SOURCES ASKS IT');
	await expect(page.locator('.pin-band')).toContainText(/1 PINNED · 1 OF THEM MANGA/);
	await page.goto(`/browse/${SOURCES.open.id}/settings`);
	const row = page.locator('form.pinned-own');
	await expect(row).toContainText('Pinned');
	await expect(row.getByRole('switch')).toBeChecked();
	// Off from settings: the page's band goes.
	await row.getByRole('switch').click();
	await expect(row.getByRole('switch')).not.toBeChecked();
	await page.goto(`/browse/${SOURCES.open.id}`);
	await expect(page.locator('.pin-band')).toHaveCount(0);
	await expect(page.getByRole('button', { name: `Pin ${SOURCES.open.name}` })).toBeVisible();
});

test('the empty search offers the pinned in BROWSE A SOURCE, and names what it asks', async ({
	page
}) => {
	await unpinEvery(page);
	await page.goto('/browse');
	await page
		.getByRole('button', { name: `Pin ${ANIME_SOURCE.name}` })
		.first()
		.click();
	await expect(
		page.getByRole('button', { name: `Pinned ${ANIME_SOURCE.name}` }).first()
	).toBeVisible();
	await page.goto('/search');
	await expect(page.locator('.label.first')).toContainText('BROWSE A SOURCE');
	await expect(page.locator('.label.first')).toContainText('PINNED');
	await expect(page.locator('.b-rows')).toContainText(ANIME_SOURCE.name);
	await expect(page.locator('.b-note')).toContainText('asks the 1 pinned');
	await page.goto('/search?q=pinword4&kind=anime');
	await expect(page.locator('a.to-sources')).toContainText(
		'1 PINNED ANIME SOURCE · RESULTS ARRIVE'
	);
});
