import Database from 'better-sqlite3';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import { bumpWebtoons, REPO, resetEngine } from './browse-world';
import { RUN_DIR } from './helpers/run-dir';

/**
 * EXTENSIONS' SELECT (card c696; doc/BROWSE.md, "Extensions and
 * repositories"): INSTALLED's ticks, the bulk bar and its one press. It runs in
 * the browse project (its name), against tests/browse-setup.ts's fake engine:
 * the rows are the few sources the world seeds, and the presses write
 * tsundoku's own switches, which are a database the other browse-* files share.
 * Every case puts back the switches it set and removes what it installed.
 */

const OPEN = 'e2e.open';
const SHELF = 'ln:shelf';
const WEBTOONS = 'eu.kanade.tachiyomi.extension.all.webtoons';
const FLAGS = ['hidden', 'addedHidden', 'offHistory', 'neverTracked'] as const;

/** The fake repository is added for the cases that install something of its own. */
let repoAdded = false;

/**
 * A selection bigger than the URL that used to carry it (round 2's second
 * review): 320 installed single-source extensions with package names of a real
 * length, so one `pkg=` per ticked row passes Node's 16 KB request head. The
 * rows are seeded into the browse world's own database — the project runs one
 * worker, and the case removes them — because a browser can only tick rows the
 * list draws. `bigSeeded` is emptied in afterEach even when a case fails.
 */
const BIG = 320;
const BIG_REPO = 9_000;
const bigPkg = (i: number) =>
	`eu.kanade.tachiyomi.extension.all.realsourcesite${String(i).padStart(4, '0')}`;
const bigId = (i: number) => `big-${String(i).padStart(4, '0')}`;
let bigSeeded: string[] = [];

/** The browse world's database, the one its preview serves. */
function browseDb() {
	const file = readdirSync(RUN_DIR).find((f) => /^tsundoku-e2e-browse-\d+\.sqlite$/.test(f));
	if (!file) throw new Error(`no browse database under the run's directory`);
	return new Database(join(RUN_DIR, file));
}

function seedBig(n: number): string[] {
	const db = browseDb();
	db.prepare(
		`INSERT OR REPLACE INTO engine_repos (id, base, name, fingerprint, added_at)
		 VALUES (?, 'https://127.0.0.1:1/big/index.min.json', 'Big Repo', 'f', 0)`
	).run(BIG_REPO);
	const ext = db.prepare(
		`INSERT OR REPLACE INTO engine_extensions
		 (pkg, repo_id, name, kind, version_code, version_name, lib, handle, installed_at, updated_at, failed)
		 VALUES (?, ?, ?, 'manga', 1, '1.0', '1.4', ?, 0, 0, '')`
	);
	const src = db.prepare(
		`INSERT OR REPLACE INTO engine_sources (id, pkg, name, lang, base_url)
		 VALUES (?, ?, ?, 'en', 'https://example.org')`
	);
	const list = db.prepare(
		`INSERT OR REPLACE INTO engine_listings (repo_id, pkg, listing) VALUES (?, ?, ?)`
	);
	const pkgs: string[] = [];
	for (let i = 0; i < n; i++) {
		const pkg = bigPkg(i);
		const id = bigId(i);
		ext.run(pkg, BIG_REPO, pkg, pkg.padEnd(64, '0'));
		src.run(id, pkg, pkg);
		// A listing one version ahead: each row is one of UPDATES, so UPDATE n
		// reaches the budget rather than answering that nothing has an update.
		list.run(
			BIG_REPO,
			pkg,
			JSON.stringify({
				pkg,
				name: pkg,
				kind: 'manga',
				versionCode: 9,
				versionName: '9.0',
				lib: '1.4',
				adult: false,
				apkUrl: '',
				jarUrl: null,
				iconUrl: null,
				sources: [{ id, name: pkg, lang: 'en', baseUrl: '' }]
			})
		);
		pkgs.push(pkg);
	}
	db.close();
	return pkgs;
}

function dropBig() {
	if (!bigSeeded.length) return;
	const db = browseDb();
	for (const pkg of bigSeeded) {
		db.prepare(`DELETE FROM engine_extensions WHERE pkg = ?`).run(pkg);
		db.prepare(`DELETE FROM engine_sources WHERE pkg = ?`).run(pkg);
	}
	// The repository's listings go with it (ON DELETE CASCADE).
	db.prepare(`DELETE FROM engine_repos WHERE id = ?`).run(BIG_REPO);
	db.close();
	bigSeeded = [];
}

/** The repository and anything installed from it, taken back: the world is shared. */
async function removeFakeRepo(page: import('@playwright/test').Page) {
	await page.goto('/browse/extensions?tab=repos');
	const fake = page.locator('.rows .row', { hasText: 'Fake Repo' });
	if ((await fake.count()) === 0) return;
	const direct = fake.getByRole('button', { name: 'REMOVE' });
	if (await direct.count()) {
		await direct.click();
		// The action answers on the tab it was posted from; wait for it to land.
		await expect(page.locator('.rows .row', { hasText: 'Fake Repo' })).toHaveCount(0);
		return;
	}
	// Something is installed from it: take that out first, and its row becomes a form.
	const origin = new URL(page.url()).origin;
	await page.request.post(`${origin}/browse/extensions?/remove`, {
		form: { pkg: WEBTOONS },
		headers: { origin, accept: 'text/html' },
		maxRedirects: 0
	});
	await page.reload();
	await page
		.locator('.rows .row', { hasText: 'Fake Repo' })
		.getByRole('button', { name: 'REMOVE' })
		.click();
	await expect(page.locator('.rows .row', { hasText: 'Fake Repo' })).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
	await resetEngine();
	repoAdded = false;
	await removeFakeRepo(page);
});

test.afterEach(async ({ page, baseURL }) => {
	dropBig();
	const origin = new URL(baseURL!).origin;
	// Every switch this file sets goes back off, for the two seeded packages it
	// ticks; REMOVE keeps a switch the way it keeps its settings (c569).
	for (const pkg of [OPEN, SHELF]) {
		for (const flag of FLAGS)
			await page.request.post(`${origin}/browse/extensions?/flags`, {
				form: { pkg, flag, value: 'false' },
				headers: { origin, accept: 'text/html' },
				maxRedirects: 0
			});
	}
	// A copy that failed half-way leaves Webtoons.com installed; REMOVE is
	// idempotent, and the row's own REMOVE would need the page.
	await page.request.post(`${origin}/browse/extensions?/remove`, {
		form: { pkg: WEBTOONS },
		headers: { origin, accept: 'text/html' },
		maxRedirects: 0
	});
	if (repoAdded) {
		repoAdded = false;
		await removeFakeRepo(page);
	}
});

const row = (page: import('@playwright/test').Page, name: string) =>
	page.locator('.rows .row', { hasText: name });

/** The bar's cell for one switch. */
const cell = (page: import('@playwright/test').Page, name: string) =>
	page.locator('.bulk .swc', { hasText: name });

/** SELECT started, and its bar drawn: a row is only a tick once that is there. */
async function startSelect(page: import('@playwright/test').Page) {
	await page.locator('.cell.sel').click();
	await expect(page.locator('.bulk')).toBeVisible();
	await expect(page.locator('.cell.count')).toHaveText('0 SELECTED');
}

test('SELECT is INSTALLED’s, and ✕, Escape and Back each end it', async ({ page }) => {
	await page.goto('/browse/extensions');
	const select = page.locator('.cell.sel');
	await expect(select).toHaveText('SELECT');
	await select.click();
	await expect(page).toHaveURL(/select=1/);
	await expect(page.locator('.bulk')).toBeVisible();
	await expect(page.locator('.cell.count')).toHaveText('0 SELECTED');
	// Leaving the tab would drop the selection without a word.
	await expect(page.locator('.tabs .tab.off')).toHaveCount(2);
	await expect(page.locator('.tabs a.tab', { hasText: 'AVAILABLE' })).toHaveCount(0);

	// A tap ticks the row; a switch press keeps SELECT on, so the cells read back.
	await row(page, 'Open Source').click();
	await expect(page.locator('.cell.count')).toHaveText('1 SELECTED');
	await expect(row(page, 'Open Source').getByRole('checkbox')).toBeChecked();

	// Escape takes SELECT down, without leaving the screen.
	await page.keyboard.press('Escape');
	await expect(page).not.toHaveURL(/select=1/);
	await expect(page.locator('.bulk')).toHaveCount(0);
	await expect(page.locator('.cell.sel')).toBeVisible();

	// ✕ too.
	await startSelect(page);
	await expect(page.locator('.bulk')).toBeVisible();
	await page.getByRole('link', { name: 'Stop selecting' }).click();
	await expect(page).not.toHaveURL(/select=1/);
	await expect(page.locator('.bulk')).toHaveCount(0);

	// And the browser's Back, which comes back to the plain list.
	await startSelect(page);
	await expect(page.locator('.bulk')).toBeVisible();
	await page.goBack();
	await expect(page).not.toHaveURL(/select=1/);
	await expect(page.locator('.bulk')).toHaveCount(0);
});

test('SELECT ALL ticks every drawn row, and the count is the drawn rows', async ({ page }) => {
	await page.goto('/browse/extensions');
	const drawn = await page.locator('.rows .row').count();
	await startSelect(page);
	await page.getByRole('button', { name: 'SELECT ALL' }).click();
	await expect(page.locator('.cell.count')).toHaveText(`${drawn} SELECTED`);
	await expect(page.locator('.rows .row input[type=checkbox]:checked')).toHaveCount(drawn);
	// A section's own TICK / UNTICK, on its label's line.
	const section = page.locator('.label', { hasText: 'NEEDS A HAND' });
	await expect(section.getByRole('link', { name: /^UNTICK/ })).toBeVisible();
	// Every seeded row is in NEEDS A HAND (none has a repository listing any
	// more), so UNTICK takes all of them off and TICK puts them back.
	await section.getByRole('link', { name: /^UNTICK/ }).click();
	await expect(page.locator('.cell.count')).toHaveText('0 SELECTED');
	await section.getByRole('link', { name: /^TICK/ }).click();
	await expect(page.locator('.cell.count')).toHaveText(`${drawn} SELECTED`);
});

test('a mixed selection reads MIXED, and one press sets every source of each', async ({ page }) => {
	// Open Source carries NEVER TRACKED from its own settings page: one of two.
	await page.goto('/browse/100/settings');
	const own = page.locator('form.own', { hasText: 'Never tracked' }).getByRole('switch');
	await own.click();
	await expect(own).toHaveAttribute('aria-checked', 'true');

	await page.goto('/browse/extensions');
	await startSelect(page);
	await row(page, 'Open Source').click();
	await row(page, 'Shelf Novels').click();
	await expect(page.locator('.cell.count')).toHaveText('2 SELECTED');

	const never = cell(page, 'NEVER TRACKED');
	await expect(never).toHaveAttribute('aria-checked', 'mixed');
	await expect(never).toContainText('MIXED · 1 OF 2');
	// Every cell's second line says what the next press does.
	await expect(never).toContainText('TAP: ALL ON');
	await never.click();

	// The press set both sources, and SELECT stayed on to read it back.
	await expect(never).toHaveAttribute('aria-checked', 'true');
	await expect(never).toContainText('2 OF 2 · TAP: ALL OFF');
	await expect(row(page, 'Open Source')).toContainText('NEVER TRACKED');
	await expect(row(page, 'Shelf Novels')).toContainText('NEVER TRACKED');

	// The plugin's own source was written too: its settings page says so.
	await page.goto('/browse/ln:shelf/settings');
	await expect(
		page.locator('form.own', { hasText: 'Never tracked' }).getByRole('switch')
	).toHaveAttribute('aria-checked', 'true');
});

test('the bar counts UPDATE and OBSOLETE apart, and does not offer what it cannot do', async ({
	page
}) => {
	await page.goto('/browse/extensions');
	await startSelect(page);
	// Nothing ticked: the switches and UPDATE have nothing to change.
	await expect(page.locator('.bulk .swc', { hasText: 'UPDATE' })).toBeDisabled();
	await expect(page.locator('.bulk .swc', { hasText: 'REMOVE' })).toHaveAttribute(
		'aria-disabled',
		'true'
	);
	// The failed row's sources are known to this world, so it ticks and counts.
	await row(page, 'Broken Source').click();
	await expect(cell(page, 'NEVER TRACKED')).toBeEnabled();
	await expect(cell(page, 'NEVER TRACKED')).toContainText('TAP: ALL ON');
	await expect(page.locator('.bulk .swc', { hasText: 'UPDATE' })).toContainText('UPDATE 0');
});

async function addRepo(page: import('@playwright/test').Page) {
	await page.goto(`/browse/extensions?tab=repos&add=${encodeURIComponent(REPO('good'))}`);
	await page.getByRole('button', { name: 'ADD Fake Repo' }).click();
	// The action's answer lands on the tab that lists it; wait for that URL, or
	// the next goto races the redirect of the action still in flight.
	await page.waitForURL(
		(u) =>
			u.pathname === '/browse/extensions' &&
			u.searchParams.get('tab') === 'repos' &&
			!u.searchParams.has('add'),
		{ timeout: 15_000 }
	);
	await expect(page.locator('.rows .row', { hasText: 'Fake Repo' })).toContainText('2 EXTENSIONS');
	repoAdded = true;
}
/** Installs Webtoons.com from it: the one package these cases may remove. */
async function installWebtoons(page: import('@playwright/test').Page) {
	await page.goto('/browse/extensions?tab=available');
	const install = row(page, 'Webtoons.com').getByRole('button', { name: 'INSTALL' });
	await install.click();
	await expect(row(page, 'Webtoons.com')).toContainText('INSTALLED ✓', { timeout: 20_000 });
}

test('UNDO puts a mixed selection back mixed, and the band marks the rows it could not change', async ({
	page
}) => {
	// One of the two already on: the press sets both, UNDO restores one each.
	await page.goto('/browse/100/settings');
	await page.locator('form.own', { hasText: 'Never tracked' }).getByRole('switch').click();
	await page.goto('/browse/extensions');
	await startSelect(page);
	await row(page, 'Open Source').click();
	await row(page, 'Shelf Novels').click();
	await cell(page, 'NEVER TRACKED').click();

	const band = page.locator('.band');
	await expect(band).toContainText('NEVER TRACKED · ON FOR 2');
	await expect(band).toContainText('2 SOURCES');
	await expect(band).toContainText('NOTHING FROM THEM IS SENT TO ANILIST, MAL OR RANOBE');
	// SELECT stays on, and the cells read back what the press set.
	await expect(page.locator('.cell.count')).toHaveText('2 SELECTED');
	await expect(cell(page, 'NEVER TRACKED')).toHaveAttribute('aria-checked', 'true');

	await band.getByRole('button', { name: 'UNDO' }).click();
	// A source already on stays on; the other goes back off, so MIXED again.
	await expect(cell(page, 'NEVER TRACKED')).toHaveAttribute('aria-checked', 'mixed');
	await expect(cell(page, 'NEVER TRACKED')).toContainText('MIXED · 1 OF 2');
	await expect(page.locator('.cell.count')).toHaveText('2 SELECTED');
	await page.goto('/browse/ln:shelf/settings');
	await expect(
		page.locator('form.own', { hasText: 'Never tracked' }).getByRole('switch')
	).toHaveAttribute('aria-checked', 'false');
});

test('a ticked row removed elsewhere is not counted as changed, and leaves the selection', async ({
	page,
	baseURL
}) => {
	await addRepo(page);
	await installWebtoons(page);
	await page.goto('/browse/extensions');
	await startSelect(page);
	await row(page, 'Webtoons.com').click();
	await row(page, 'Open Source').click();
	// Another device removes the extension between the tick and the press.
	await page.request.post(`${new URL(baseURL!).origin}/browse/extensions?/remove`, {
		form: { pkg: WEBTOONS },
		headers: { origin: new URL(baseURL!).origin, accept: 'text/html' },
		maxRedirects: 0
	});
	await cell(page, 'ADDED HIDDEN').click();
	const band = page.locator('.band');
	await expect(band).toContainText('ADDED HIDDEN · ON FOR 1 OF 2');
	await expect(band).toContainText('1 NOT CHANGED: NO LONGER INSTALLED');
	await expect(band).toContainText('IT LEFT THE LIST AND THE SELECTION');
	await expect(page.locator('.cell.count')).toHaveText('1 SELECTED');
});

test('HIDE leaves the list outside reveal, and its UNDO brings the row back', async ({ page }) => {
	await page.goto('/browse/extensions');
	await startSelect(page);
	await row(page, 'Open Source').click();
	await page.locator('.bulk .swc', { hasText: 'HIDE' }).click();
	const band = page.locator('.band');
	await expect(band).toContainText('HIDDEN · 1 EXTENSION');
	await expect(band).toContainText('THEY LEFT THE LIST AND THE SELECTION · REVEAL SHOWS THEM');
	await expect(row(page, 'Open Source')).toHaveCount(0);
	// SELECT stays on at 0, so UNDO stays reachable (Results).
	await expect(page.locator('.cell.count')).toHaveText('0 SELECTED');
	await band.getByRole('button', { name: 'UNDO' }).click();
	await expect(row(page, 'Open Source')).toBeVisible();
	await expect(page.locator('.band')).toHaveCount(0);
});

test('UPDATE narrows UPDATE ALL to the ticked row, and its UNDO is BACK TO', async ({ page }) => {
	await addRepo(page);
	await installWebtoons(page);
	await bumpWebtoons();
	await page.goto('/browse/extensions');
	await page.getByRole('button', { name: 'CHECK NOW' }).click();
	await expect(page.locator('.label', { hasText: 'UPDATES' })).toContainText('UPDATE ALL 1');
	await startSelect(page);
	await row(page, 'Webtoons.com').click();
	await page.locator('.bulk .swc', { hasText: 'UPDATE 1' }).click();
	const band = page.locator('.band');
	await expect(band).toContainText('UPDATED · 1 EXTENSION');
	await expect(band).toContainText('UNDO GOES BACK TO THEM');
	// SELECT ended on success, and the row is the new version.
	await expect(page.locator('.bulk')).toHaveCount(0);
	await expect(row(page, 'Webtoons.com')).toContainText('1.6.3');
	// UNDO's form posts every updated row: the band loops over `update.done`
	// (the two-row list is proven through the real load in
	// tests/extensions-select-db.spec.ts), and carries the version each one was
	// left on, so UNDO can refuse a row that went back since.
	const undoForm = band.locator('form');
	await expect(undoForm.locator('input[name=pkg]')).toHaveCount(1);
	await expect(undoForm.locator('input[name=pkg]')).toHaveValue(WEBTOONS);
	await expect(undoForm.locator('input[name=ver]')).toHaveCount(1);
	await expect(undoForm.locator('input[name=ver]')).toHaveValue('1.6.3');
	await band.getByRole('button', { name: 'UNDO' }).click();
	await expect(row(page, 'Webtoons.com')).toContainText('1.6.2');
	await expect(page.locator('.band')).toContainText('BACK TO · 1 EXTENSION');
	// SELECT ended on success, and the next one starts with nothing ticked.
	await startSelect(page);
	await expect(page.locator('.cell.count')).toHaveText('0 SELECTED');
});

test('a SELECT straight after UPDATE starts with nothing ticked, no UNDO in between', async ({
	page
}) => {
	await addRepo(page);
	await installWebtoons(page);
	await bumpWebtoons();
	await page.goto('/browse/extensions');
	await page.getByRole('button', { name: 'CHECK NOW' }).click();
	await expect(page.locator('.label', { hasText: 'UPDATES' })).toContainText('UPDATE ALL 1');
	await startSelect(page);
	await row(page, 'Webtoons.com').click();
	await page.locator('.bulk .swc', { hasText: 'UPDATE 1' }).click();
	await expect(page.locator('.band')).toContainText('UPDATED · 1 EXTENSION');
	// The bulk form is `use:enhance`: the redirect is a client goto on this
	// component and the tick set survives it. Press SELECT at once — this is the
	// state wave 42's e2e ended before, because it pressed the band's native UNDO
	// first and that full load emptied the set.
	await expect(page.locator('.bulk')).toHaveCount(0);
	await startSelect(page);
	await expect(row(page, 'Webtoons.com').getByRole('checkbox')).not.toBeChecked();
});

test('a SELECT straight after REMOVE starts empty, even the row that stayed', async ({ page }) => {
	await addRepo(page);
	await installWebtoons(page);
	await page.goto('/browse/extensions');
	await startSelect(page);
	await row(page, 'Webtoons.com').click();
	await row(page, 'Open Source').click();
	await page.locator('.bulk .swc', { hasText: 'REMOVE 1' }).click();
	await page.getByRole('dialog').getByRole('button', { name: 'REMOVE 1' }).click();
	await expect(page.locator('.band')).toContainText('REMOVED · 1 EXTENSION');
	// Open Source stayed installed (OBSOLETE) and was ticked before the press.
	await expect(row(page, 'Open Source')).toBeVisible();
	await startSelect(page);
	await expect(row(page, 'Open Source').getByRole('checkbox')).not.toBeChecked();
});

test('a press on one source says 1 SOURCE, not 1 SOURCES', async ({ page }) => {
	await page.goto('/browse/extensions');
	await startSelect(page);
	// Shelf Novels is the LNReader plugin: its one source is its one id.
	await row(page, 'Shelf Novels').click();
	await cell(page, 'NEVER TRACKED').click();
	await expect(page.locator('.band .detail')).toContainText('1 SOURCE ·');
});

test('a press whose every row left the list says NOT CHANGED, not the switch', async ({
	page,
	baseURL
}) => {
	await addRepo(page);
	await installWebtoons(page);
	await page.goto('/browse/extensions');
	await startSelect(page);
	await row(page, 'Webtoons.com').click();
	// Another device removes it between the tick and the press: nothing can change.
	await page.request.post(`${new URL(baseURL!).origin}/browse/extensions?/remove`, {
		form: { pkg: WEBTOONS },
		headers: { origin: new URL(baseURL!).origin, accept: 'text/html' },
		maxRedirects: 0
	});
	await page.locator('.bulk .swc', { hasText: 'HIDE' }).click();
	const band = page.locator('.band');
	await expect(band.locator('.title')).toHaveText('NOT CHANGED');
	await expect(band).not.toContainText('THEY LEFT THE LIST AND THE SELECTION');
	await expect(band.locator('.detail')).toContainText('1 NOT CHANGED: NO LONGER INSTALLED');
});

test('a band from its URL keeps every row of every list, and UPDATE’s UNDO posts each', async ({
	page
}) => {
	// The action writes `done=a&done=b`; the load must read both, and the form
	// must post one `pkg` per updated row (round 2: it used to keep the first).
	await page.goto(
		'/browse/extensions?band=update&done=e2e.open&done=ln:shelf&miss=e2e.hidden&of=3&no=0'
	);
	const band = page.locator('.band');
	await expect(band).toContainText('UPDATED · 2 OF 3');
	await expect(band.locator('input[name=pkg]')).toHaveCount(2);
	await expect(band.locator('input[name=pkg]').nth(0)).toHaveValue('e2e.open');
	await expect(band.locator('input[name=pkg]').nth(1)).toHaveValue('ln:shelf');
});

test('320 real-length ticked rows reach the refusal band, not the error page', async ({ page }) => {
	bigSeeded = seedBig(BIG);
	await page.goto('/browse/extensions');
	await startSelect(page);
	const drawn = await page.locator('.rows .row').count();
	await page.getByRole('button', { name: 'SELECT ALL' }).click();
	await expect(page.locator('.cell.count')).toHaveText(`${drawn} SELECTED`);

	// Each press's own request carries its ticks in the body, never in the URL:
	// before the fix the formaction held one `pkg=` per row (~18 KB here) and
	// the browser met a 431 error page before any guard could refuse.
	const band = page.locator('.band');
	await cell(page, 'NEVER TRACKED').click();
	await expect(band.locator('.title')).toHaveText('TOO MANY SOURCES TO CHANGE AT ONCE');
	await expect(page.locator('.bulk')).toBeVisible();
	await expect(page.locator('.cell.count')).toHaveText(`${drawn} SELECTED`);

	await page.locator('.bulk .swc', { hasText: 'UPDATE' }).click();
	await expect(band.locator('.title')).toHaveText('TOO MANY SOURCES TO CHANGE AT ONCE');
	await expect(page.locator('.bulk')).toBeVisible();

	// REMOVE's question is a URL again, so it is refused before the browser asks
	// for one too long to send.
	await page.locator('.bulk .swc', { hasText: 'REMOVE' }).click();
	await expect(band.locator('.title')).toHaveText('TOO MANY SOURCES TO CHANGE AT ONCE');
	await expect(page.locator('.bulk')).toBeVisible();
	await expect(page.locator('.cell.count')).toHaveText(`${drawn} SELECTED`);

	// Nothing was written: no switch, no install, no removal.
	const db = browseDb();
	const keys = bigSeeded.map((_, i) => `source.never-tracked:${bigId(i)}`);
	expect(
		db
			.prepare(`SELECT COUNT(*) AS n FROM settings WHERE key IN (${keys.map(() => '?').join(',')})`)
			.get(...keys)
	).toEqual({ n: 0 });
	expect(
		db
			.prepare(
				`SELECT COUNT(*) AS n FROM engine_extensions
				 WHERE pkg IN (SELECT value FROM json_each(?)) AND version_name = '1.0'`
			)
			.get(JSON.stringify(bigSeeded))
	).toEqual({ n: BIG });
	db.close();
});

test.describe('without script', () => {
	test.use({ javaScriptEnabled: false });

	/**
	 * The fake repository and Webtoons.com, through the actions themselves (a
	 * request needs no script): added, installed, and its listing moved one
	 * version on so UPDATE has something to take. `repoAdded` is set at once so
	 * afterEach takes the repository out even if this fails half-way.
	 */
	async function addAndInstall(page: import('@playwright/test').Page, base: string) {
		const origin = new URL(base).origin;
		const post = (path: string, form: Record<string, string>) =>
			page.request.post(`${origin}${path}`, {
				form,
				headers: { origin, accept: 'text/html' },
				maxRedirects: 0
			});
		expect((await post('/browse/extensions?/addRepo', { address: REPO('good') })).status()).toBe(
			303
		);
		repoAdded = true;
		expect((await post('/browse/extensions?/install', { pkg: WEBTOONS })).status()).toBe(200);
		await bumpWebtoons();
		expect((await post('/browse/extensions?/check', {})).status()).toBe(200);
	}

	test('a ticked row can be switched, updated and removed', async ({ page, baseURL }) => {
		await addAndInstall(page, baseURL!);
		await page.goto('/browse/extensions?select=1');
		// SELECT is the URL, and the server draws its bar and cells pressable: a
		// native checkbox is the form's own field even with no script.
		await expect(page.locator('.bulk')).toBeVisible();
		await expect(cell(page, 'NEVER TRACKED')).toBeEnabled();
		await expect(page.locator('.bulk .swc', { hasText: 'UPDATE' })).toBeEnabled();

		await row(page, 'Open Source').getByRole('checkbox').check();
		await cell(page, 'NEVER TRACKED').click();
		// The press posts the form's own ticks; the redirect carries them back.
		const band = page.locator('.band');
		await expect(band).toContainText('NEVER TRACKED · ON FOR 1');
		await expect(band).toContainText('1 SOURCE');
		await expect(row(page, 'Open Source').getByRole('checkbox')).toBeChecked();
		const db = browseDb();
		expect(
			db.prepare(`SELECT value FROM settings WHERE key = ?`).get('source.never-tracked:100')
		).toEqual({ value: '1' });
		db.close();

		// UPDATE takes the row whose repository lists a newer version.
		await row(page, 'Webtoons.com').getByRole('checkbox').check();
		await page.locator('.bulk .swc', { hasText: 'UPDATE' }).click();
		await expect(page.locator('.band')).toContainText('UPDATED · 1 EXTENSION');
		await expect(row(page, 'Webtoons.com')).toContainText('1.6.3');

		// REMOVE asks through its sheet: the bar's cell is a GET of the form, so
		// the ticked row's package travels without a link built from `selected`.
		await page.goto('/browse/extensions?select=1');
		await row(page, 'Webtoons.com').getByRole('checkbox').check();
		await page.locator('.bulk .swc', { hasText: 'REMOVE' }).click();
		const sheet = page.getByRole('dialog');
		await expect(sheet).toContainText('REMOVE 1 EXTENSION?');
		await expect(sheet).toContainText('WEBTOONS.COM');
		// The sheet rises in; Enter submits its form without waiting on the
		// entrance animation's box, which a click's stability check times out on.
		await sheet.getByRole('button', { name: 'REMOVE 1' }).press('Enter');
		await expect(page.locator('.band')).toContainText('REMOVED · 1 EXTENSION');
		await expect(row(page, 'Webtoons.com')).toHaveCount(0);
	});

	test('a press with nothing ticked is refused, and the POST is made', async ({ page }) => {
		await page.goto('/browse/extensions?select=1');
		// Drawn pressable on the server: with script it would be disabled once
		// hydrated, but this page never hydrates.
		await expect(cell(page, 'NEVER TRACKED')).toBeEnabled();
		const posted = page.waitForRequest(
			(r) => r.method() === 'POST' && new URL(r.url()).searchParams.has('/flags')
		);
		await cell(page, 'NEVER TRACKED').click();
		await posted;
		await expect(page.locator('.band .title')).toHaveText('NOTHING TICKED');
		// Nothing was written.
		const db = browseDb();
		expect(
			db.prepare(`SELECT value FROM settings WHERE key = ?`).get('source.never-tracked:100')
		).toBeUndefined();
		db.close();
	});

	test('a refused press comes back with its row still ticked', async ({ page }) => {
		await page.goto('/browse/extensions?select=1');
		await row(page, 'Open Source').getByRole('checkbox').check();
		// Open Source is OBSOLETE in this world: nothing lists an update for it,
		// so UPDATE refuses. The page is a fresh mount on an action URL with no
		// ticks: only the refusal's own `selected` can tick the row again.
		await page.locator('.bulk .swc', { hasText: 'UPDATE' }).click();
		await expect(page.locator('.band .title')).toHaveText('NOTHING TICKED HAS AN UPDATE');
		await expect(row(page, 'Open Source').getByRole('checkbox')).toBeChecked();
		await expect(page.locator('.cell.count')).toHaveText('1 SELECTED');
	});
});

test('REMOVE asks first for the whole selection, and has no UNDO', async ({ page }) => {
	await addRepo(page);
	await installWebtoons(page);
	await page.goto('/browse/extensions');
	await startSelect(page);
	await row(page, 'Webtoons.com').click();
	await row(page, 'Open Source').click();
	// Open Source is OBSOLETE in this world (no repository lists it any more), so
	// it stays installed and the count is the one that may go (Results).
	await page.locator('.bulk .swc', { hasText: 'REMOVE 1' }).click();
	const sheet = page.getByRole('dialog');
	await expect(sheet).toContainText('REMOVE 1 EXTENSION?');
	await expect(sheet).toContainText('OF 2 SELECTED · WEBTOONS.COM');
	await expect(sheet).toContainText('1 STAYS INSTALLED: OBSOLETE');
	await expect(sheet).toContainText('SETTINGS ARE KEPT FOR A REINSTALL');
	// CANCEL leaves everything as it was.
	await sheet.getByRole('button', { name: 'CANCEL' }).click();
	await expect(page.locator('.cell.count')).toHaveText('2 SELECTED');
	// One of them only: the sheet's own count follows the selection.
	await row(page, 'Open Source').click();
	await expect(page.locator('.cell.count')).toHaveText('1 SELECTED');
	await page.locator('.bulk .swc', { hasText: 'REMOVE 1' }).click();
	await expect(page.getByRole('dialog')).toContainText('REMOVE 1 EXTENSION?');
	await page.getByRole('dialog').getByRole('button', { name: 'REMOVE 1' }).click();
	const band = page.locator('.band');
	await expect(band).toContainText('REMOVED · 1 EXTENSION');
	await expect(band.getByRole('button', { name: 'UNDO' })).toHaveCount(0);
	await expect(page.locator('.bulk')).toHaveCount(0);
	await expect(row(page, 'Webtoons.com')).toHaveCount(0);
});
