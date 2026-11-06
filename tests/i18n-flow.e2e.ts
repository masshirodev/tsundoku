import type { Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { expect, test } from './fixtures';

/**
 * The languages (doc/I18N.md; card c210), end to end: the browser's language
 * decides until the device chooses, the choice is a cookie the server reads
 * on the first byte, and AUTO hands it back to the browser.
 */

const languageRow = (page: Page) =>
	page.locator('.row', { has: page.locator('.label', { hasText: /^APP LANGUAGE$/ }) });

test.describe('a browser that speaks Portuguese', () => {
	test.use({ locale: 'pt-BR' });

	test('reads tsundoku in Portuguese, from the first byte', async ({ page, request }) => {
		const html = await (
			await request.get('/start', { headers: { 'accept-language': 'pt-BR' } })
		).text();
		expect(html).toMatch(/<html [^>]*lang="pt-BR"/);
		await page.goto('/start');
		await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
		await expect(page.getByRole('heading', { level: 1, name: 'PRIMEIROS PASSOS' })).toBeVisible();
	});

	test('the series screen’s two offers speak Portuguese (c587)', async ({ page, context }) => {
		// Both offers are the screen's own state, and no flow file may share a
		// series with another (`doc/TESTING.md`), so this case seeds its own:
		// three hidden doujin singles and a Work of two of them, in the hidden
		// root. Another file runs with reveal off, where none of them is listed,
		// and they are deleted again below. The seed stands in for the owner's
		// own doors: GROUP over three singles makes the Work (only two parts, as
		// the trigger requires), and the third is the newcomer the offer names.
		await context.addCookies([{ name: 'tsundoku_reveal', value: '1', url: 'http://localhost' }]);
		const db = new Database(process.env.PLAYWRIGHT_DATABASE_PATH!);
		const hiddenRoot = (
			db.prepare(`SELECT id FROM roots WHERE hidden = 1 LIMIT 1`).get() as { id: number }
		).id;
		const now = Date.UTC(2026, 10, 6, 12);
		const single = db.prepare(
			`INSERT INTO series (root_id, title, kind, rating, favourite, hue, added_at, indexed_at,
				alt_titles, source, status, description, path)
			VALUES (?, ?, 'doujin', 0, 0, 200, ?, ?, '[]', 'hentoid', '', '', ?)`
		);
		const entry = db.prepare(
			`INSERT INTO entries (series_id, position, label, added_at, page_count, file, bytes)
			VALUES (?, 1, 'Book', ?, 20, '', 0)`
		);
		const add = (title: string) => {
			const id = Number(single.run(hiddenRoot, title, now, now, `/x/${title}`).lastInsertRowid);
			entry.run(id, now);
			return id;
		};
		const first = add('Kaze no Uta');
		const second = add('Kaze no Uta Zero');
		const newcomer = add('Kaze no Uta Zoku');
		const work = Number(
			db
				.prepare(`INSERT INTO works (name, created_at, order_mode) VALUES (?, ?, 'hand')`)
				.run('Kaze no Uta', now).lastInsertRowid
		);
		db.prepare(
			`INSERT INTO work_series (work_id, series_id, position) VALUES (?, ?, 1), (?, ?, 2)`
		).run(work, first, work, second);
		let failed: unknown = null;
		try {
			await page.goto(`/series/${newcomer}`);
			// MIGHT BE ONE SERIES: the three singles share a stem.
			await expect(page.locator('.sugg:not(.offer)').getByText('PODE SER UMA SÉRIE')).toBeVisible();
			// MIGHT CONTINUE <WORK> · AS PART N: the Work of two, and the newcomer after it.
			await expect(
				page.locator('.sugg.offer').getByText('PODE CONTINUAR KAZE NO UTA · COMO PARTE 3')
			).toBeVisible();
			// Its cells too, so the offer is usable in the language it is drawn in.
			await expect(page.getByRole('button', { name: 'NÃO É ESTA' })).toBeVisible();
			await expect(page.getByRole('button', { name: 'NÃO É UMA SÉRIE' })).toBeVisible();
		} catch (e) {
			failed = e;
		}
		// The rows go whether the case passed or not, and the body's failure is
		// the one reported when both fail (c649's class).
		try {
			db.prepare(`DELETE FROM series WHERE id IN (?, ?, ?)`).run(first, second, newcomer);
			db.prepare(`DELETE FROM works WHERE id = ?`).run(work);
		} catch (e) {
			if (!failed) throw e;
		}
		db.close();
		if (failed) throw failed;
	});

	test('ENGLISH in SETTINGS wins over the browser, and AUTO gives it back', async ({ page }) => {
		await page.goto('/settings#s-devices');
		const row = languageRow(page);
		await expect(row.getByRole('button', { name: 'AUTO' })).toHaveAttribute('aria-pressed', 'true');
		await Promise.all([
			page.waitForEvent('load'),
			row.getByRole('button', { name: 'ENGLISH' }).click()
		]);
		await expect(page.locator('html')).toHaveAttribute('lang', 'en');
		const cookies = await page.context().cookies();
		expect(cookies.find((c) => c.name === 'tsundoku_lang')?.value).toBe('en');
		await page.goto('/start');
		await expect(page.getByRole('heading', { level: 1, name: 'GET STARTED' })).toBeVisible();

		await page.goto('/settings#s-devices');
		await expect(languageRow(page).getByRole('button', { name: 'ENGLISH' })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		await Promise.all([
			page.waitForEvent('load'),
			languageRow(page).getByRole('button', { name: 'AUTO' }).click()
		]);
		await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
		expect((await page.context().cookies()).some((c) => c.name === 'tsundoku_lang')).toBe(false);
	});
});

test('an English browser can choose Portuguese', async ({ page }) => {
	await page.goto('/settings#s-devices');
	await Promise.all([
		page.waitForEvent('load'),
		languageRow(page).getByRole('button', { name: 'PORTUGUÊS (BRASIL)' }).click()
	]);
	await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
	await page.goto('/start');
	await expect(page.getByText('00 — PRIMEIROS PASSOS')).toBeVisible();
	// Paraglide's own cookie is never written: AUTO must stay AUTO (doc/I18N.md).
	expect((await page.context().cookies()).some((c) => c.name === 'PARAGLIDE_LOCALE')).toBe(false);
});
