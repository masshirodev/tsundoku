import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import { makeLogin, writeLogin } from '../src/lib/server/login.ts';
import { FRIEND_HOME } from './friend-world';

/**
 * SAVE A REPORT (doc/LOGS.md; card c193), on the friend project's install: a
 * log carrying what must never leave the house, and the report that leaves
 * without it. Hidden means hidden.
 */
test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
	writeLogin(FRIEND_HOME, makeLogin(null));
	mkdirSync(join(FRIEND_HOME, 'logs'), { recursive: true });
	writeFileSync(
		join(FRIEND_HOME, 'logs', 'tsundoku.log'),
		[
			'2026-10-30T18:00:00.000Z INFO  Listening on http://127.0.0.1:4197',
			`2026-10-30T18:00:01.000Z INFO  reading ${FRIEND_HOME}/tsundoku.sqlite`,
			'2026-10-30T18:00:02.000Z INFO  imported "Kōhai no Himitsu Nikki" (1 book)',
			'2026-10-30T18:00:03.000Z INFO  GET /pair/PoJ8cBL1qtir9cPx 303',
			'2026-10-30T18:00:04.000Z ERROR cookie tsundoku_session=deadbeefdeadbeef',
			'2026-10-30T18:00:05.000Z ERROR the engine said no'
		].join('\n') + '\n'
	);
});

test('SETTINGS › 05 — LIBRARY saves a report: versions and logs, nothing hidden or secret', async ({
	page
}) => {
	await page.goto('/settings#s-library');
	const save = page.getByRole('link', { name: 'SAVE', exact: true });
	await expect(save).toBeVisible();
	await expect(page.getByText(/NOTHING YOU'VE HIDDEN, NO PASSWORDS OR TOKENS/)).toBeVisible();
	const [download] = await Promise.all([page.waitForEvent('download'), save.click()]);
	expect(download.suggestedFilename()).toMatch(/^tsundoku-report-\d{4}-\d{2}-\d{2}\.txt$/);
	const text = await (
		await download.createReadStream()
	)
		.toArray()
		.then((c) => Buffer.concat(c).toString());
	expect(text).toMatch(/^tsundoku report, /);
	expect(text).toMatch(/version\s+\S+/);
	expect(text).toContain('tsundoku.log, last 300 lines');
	expect(text).toContain('the engine said no');
	// Never: a hidden title, a pairing code, a cookie, the data folder's path.
	expect(text).not.toContain('Kōhai no Himitsu Nikki');
	expect(text).toContain('imported "[hidden]"');
	expect(text).not.toContain('PoJ8cBL1qtir9cPx');
	expect(text).not.toContain('deadbeefdeadbeef');
	expect(text).not.toContain(FRIEND_HOME);
	expect(text).toContain('<data>/tsundoku.sqlite');
});
