import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import { E2E_TOKEN } from '../playwright.config';

// Start signed out: this spec is about the sign-in, not what is behind it.
test.use({ storageState: { cookies: [], origins: [] } });

test('everything but the login form is behind the token', async ({ page, request }) => {
	await page.goto('/');
	await expect(page).toHaveURL(/\/login\?next=%2F/);
	const api = await request.get('/api/series/1', { maxRedirects: 0 });
	expect(api.status()).toBe(401);
});

test('a wrong token is refused and the right one lets you in', async ({ page }) => {
	await page.goto('/login');
	await page.getByLabel('TOKEN').fill('nope');
	await page.getByRole('button', { name: 'UNLOCK' }).click();
	await expect(page.getByText('THAT TOKEN IS NOT RIGHT')).toBeVisible();

	await page.getByLabel('TOKEN').fill(E2E_TOKEN);
	await page.getByRole('button', { name: 'UNLOCK' }).click();
	await expect(page).toHaveURL('/');
	await expect(page.getByText('01 — CONTINUE')).toBeVisible();
});

/**
 * The browser's own chrome (the status bar, the task switcher) takes its
 * colour from `<meta name="theme-color">`, and with two in the head the
 * first wins. The root layout writes the theme's own in the first byte, so
 * the page's shell must carry none ahead of it, or light mode draws a dark
 * bar over a light page. The sign-in page shows it with no session at all.
 */
test('the first byte carries one theme-color, the theme’s own', async ({ page, baseURL }) => {
	const metas = async () =>
		[
			...(await (await page.context().request.get('/login')).text()).matchAll(
				/<meta name="theme-color" content="([^"]*)"/g
			)
		].map((m) => m[1]);
	expect(await metas()).toEqual(['#0e0f10']);
	await page.context().addCookies([{ name: 'tsundoku_theme', value: 'light', url: baseURL! }]);
	expect(await metas()).toEqual(['#f5f4ef']);
});

/**
 * A built bundle started bare, `node build` with no token and no NODE_ENV,
 * as a friend or a container might start it rather than through
 * scripts/serve.ts. The no-token bypass belongs to `vite dev` alone, so this
 * refuses every page and every API call instead of opening the library.
 */
// eslint-disable-next-line no-empty-pattern -- Playwright needs the object pattern
test('a built bundle with no token refuses everything', async ({}, info) => {
	test.skip(info.project.name !== 'tablet-portrait', 'one server is enough: no device is involved');
	const port = await new Promise<number>((resolve, reject) => {
		const probe = createServer();
		probe.once('error', reject);
		probe.listen(0, '127.0.0.1', () => {
			const { port } = probe.address() as AddressInfo;
			probe.close(() => resolve(port));
		});
	});
	const dir = mkdtempSync(join(tmpdir(), 'bare-build-'));
	const env: NodeJS.ProcessEnv = { ...process.env };
	for (const k of ['NODE_ENV', 'TSUNDOKU_TOKEN', 'TSUNDOKU_LOGIN', 'TSUNDOKU_SERVE', 'ORIGIN'])
		delete env[k];
	const server = spawn(process.execPath, ['build'], {
		env: {
			...env,
			HOST: '127.0.0.1',
			PORT: String(port),
			DATABASE_PATH: join(dir, 'db.sqlite'),
			TSUNDOKU_HOME: join(dir, 'home'),
			LIBRARY_ROOT: join(dir, 'library'),
			BACKUP_DIR: join(dir, 'backups'),
			ENGINE_URL: 'http://127.0.0.1:1',
			TSUNDOKU_ANILIST: 'off'
		},
		stdio: 'ignore'
	});
	try {
		const base = `http://127.0.0.1:${port}`;
		let first: Response | null = null;
		for (let i = 0; i < 120 && !first; i++) {
			first = await fetch(`${base}/`, { redirect: 'manual' }).catch(() => null);
			if (!first) await new Promise((r) => setTimeout(r, 250));
		}
		expect(first?.status).toBe(503);
		for (const path of ['/api/library', '/api/series/1', '/search'])
			expect((await fetch(`${base}${path}`, { redirect: 'manual' })).status).toBe(503);
	} finally {
		server.kill();
		rmSync(dir, { recursive: true, force: true });
	}
});
