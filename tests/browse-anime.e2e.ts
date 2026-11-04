import { test, expect } from './helpers/hydrated';
import { ANIME_SOURCE } from './browse-world';

/**
 * An anime series in the library and on the series screen (doc/ANIME.md;
 * card c153), on the browse server's seeded "Tsukiakari no Ryokōsha"
 * (tests/browse-setup.ts), as Index Anime Series and Anime States 1a draw it.
 * The handoff's literals are pinned, so a tidy-up can't round them away.
 */

test('the library has an ANIME shelf, and CONTINUE says the episode and the time left', async ({
	page
}) => {
	await page.goto('/');
	await expect(page.locator('.cont')).toContainText('ANIME · S2 EP. 7 · 14:32 LEFT');
	// The episode's bar, 568 of 1,440 s, not the series' 18 of 24.
	await expect(page.locator('.cont')).toContainText('39%');
	const tab = page.getByRole('link', { name: /^ANIME/ });
	await expect(tab).toBeVisible();
	await tab.click();
	await expect(page.locator('.grid .tile', { hasText: 'Tsukiakari no Ryokōsha' })).toBeVisible();
});

test('an anime series: its count, CONTINUE, and episodes by season', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('link', { name: /^ANIME/ }).click();
	await page.locator('.grid .tile', { hasText: 'Tsukiakari no Ryokōsha' }).click();
	await expect(page).toHaveURL(/\/series\/\d+/);

	await expect(page.locator('.names .meta')).toHaveText('ANIME · ANIMEPAHE · ONGOING');
	await expect(page.locator('.names .count')).toHaveText('24 EPISODES · 2 SEASONS · 18 WATCHED');
	await expect(page.locator('a.cta')).toContainText('▶ CONTINUE');
	await expect(page.locator('a.cta')).toContainText('S2 · EP. 7 · 14:32 LEFT');

	const list = page.getByRole('region', { name: 'Episodes' });
	await expect(list.locator('.title')).toContainText('01 — EPISODES');
	await expect(list.locator('.title')).toContainText('24 · 18 WATCHED');
	// Season 1 is watched through: one row, folded.
	const fold = list.locator('.fold button');
	await expect(fold).toContainText('↑ SEASON 1 · EP. 1 – 12');
	await expect(fold).toContainText('12 WATCHED · SHOW');
	await expect(list.locator('.season')).toHaveText(['SEASON 2 · EP. 1 – 12 6 WATCHED']);

	const row = (title: string) => list.locator('.entry', { hasText: title });
	await expect(row('The Lantern Market').locator('.status')).toHaveText('14:32 LEFT');
	await expect(row('The Lantern Market').locator('.num')).toHaveText('7');
	await expect(row('The Lantern Market').locator('.bar')).toBeVisible();
	await expect(row('Salt Road').locator('.status')).toHaveText('410 MB');
	await expect(row("The Ferryman's Count").locator('.status')).toHaveText('NOT DOWNLOADED');
	await expect(row('Two Roads North').locator('.status')).toHaveText('WATCHED');
	await expect(list.locator('.entry', { hasText: 'RECAP · 24 MIN' })).toHaveCount(1);
	await expect(list.locator('.entry', { hasText: 'FILLER · 24 MIN' })).toHaveCount(1);

	// The handoff's measurements: 72px rows, a 96×54 picture, a 64px number column.
	const btn = row('Salt Road').locator('.entry-btn');
	await expect(btn).toHaveCSS('height', '72px');
	await expect(row('Salt Road').locator('.thumb')).toHaveCSS('width', '96px');
	await expect(row('Salt Road').locator('.thumb')).toHaveCSS('height', '54px');
	await expect(row('Salt Road').locator('.num')).toHaveCSS('width', '64px');
	await expect(row('Salt Road').locator('.t')).toHaveCSS('font-size', '16px');
	await expect(row('Salt Road').locator('.m')).toHaveCSS('font-size', '12px');
	await expect(list.locator('.season')).toHaveCSS('height', '44px');
	await expect(fold).toHaveCSS('height', '52px');

	// SHOW opens season 1; # finds an episode by its number in the season being watched.
	await fold.click();
	await expect(list.locator('.season')).toHaveCount(2);
	await list.getByRole('button', { name: 'Go to episode number' }).click();
	await page.getByLabel('GO TO EP.').fill('9');
	await page.getByLabel('GO TO EP.').press('Enter');
	await expect(row('A Letter from Hollin')).toHaveClass(/flash/);
});

test('an anime source is browsed, previewed with its EPISODES, and added by season (c154)', async ({
	page
}) => {
	await page.goto('/browse');
	await expect(page.locator('.screen > .label', { hasText: 'ANIME' })).toBeVisible();
	await page
		.getByRole('link', { name: new RegExp(ANIME_SOURCE.name) })
		.first()
		.click();
	await expect(page).toHaveURL(new RegExp(`/browse/${ANIME_SOURCE.id}$`));
	await page.locator('.grid .tile', { hasText: 'Kōri no Shiro no Majo' }).click();
	await expect(page).toHaveURL(/\/downloads\/source\//);
	const add = page.getByRole('button', { name: /ADD TO LIBRARY/ });
	// Watching first, adding beside it (Online Calls 1D): ▶ starts the first episode.
	await expect(page.locator('.cta-go .cta')).toContainText('▶ EP. 1');
	await expect(page.getByRole('region', { name: 'Episodes' }).locator('.head')).toContainText(
		'4 · EVERY ONE STREAMS'
	);
	await expect(page.getByRole('region', { name: 'Episodes' })).toContainText('S2 · Ep. 2 · Thaw');
	await add.click();
	await expect(page).toHaveURL(/\/series\/\d+\?added=/);
	await expect(page.locator('.names .meta')).toHaveText('ANIME · MOONLIGHT STREAMS · COMPLETED');
	const list = page.getByRole('region', { name: 'Episodes' });
	await expect(list.locator('.season')).toHaveText([
		'SEASON 1 · EP. 1 – 2 NONE WATCHED',
		'SEASON 2 · EP. 1 – 2 NONE WATCHED'
	]);
	await expect(list.locator('.entry', { hasText: 'The First Snow' }).locator('.status')).toHaveText(
		'NOT DOWNLOADED'
	);
	await expect(page.locator('a.cta')).toContainText('▶ START');
	await expect(page.locator('a.cta')).toContainText('S1 · EP. 1 · STREAMS');
});

test('an episode plays from the preview without ADD, and the series stays off the shelves (c161)', async ({
	page
}) => {
	test.setTimeout(60_000);
	await page.goto(`/browse/${ANIME_SOURCE.id}`);
	await page.locator('.grid .tile', { hasText: 'Yuki no Tabibito' }).click();
	await expect(page).toHaveURL(/\/downloads\/source\//);
	const preview = page.url();
	await page.getByRole('button', { name: 'Play S1 · Ep. 1 · The First Snow' }).click();
	await expect(page).toHaveURL(/\/read\/\d+/);
	await expect(page.locator('.player')).toBeVisible();
	// The player's top bar offers + ADD where a library series has nothing (c165).
	await expect(
		page.getByRole('region', { name: 'Controls' }).getByRole('button', { name: '+ ADD' })
	).toBeVisible();
	// Watched a little, as the player reports it, so HISTORY has a row.
	const entryId = Number(/\/read\/(\d+)/.exec(page.url())![1]);
	const back = await page.locator('a[href*="/series/"]').first().getAttribute('href');
	const seriesId = Number(/\/series\/(\d+)/.exec(back!)![1]);
	const watched = await page.request.post('/api/reading', {
		data: { seriesId, entryId, kind: 'page', page: 2, length: 8 }
	});
	expect(await watched.json()).toEqual({ saved: true });
	// ← SERIES is its preview, with + ADD still offered: it was never added.
	await page.goto(preview);
	await expect(page.getByRole('button', { name: /ADD TO LIBRARY/ })).toBeVisible();
	// The record says what it is, and ▶ continues where it stopped (c165, Online Calls 1D).
	const record = page.locator('.row.record');
	await expect(record).toContainText('Not in library · 0 of 4 watched');
	await expect(record).toContainText('KEPT UNTIL');
	await expect(page.locator('.names .meta')).toContainText('NOT IN LIBRARY');
	await expect(page.locator('.cta-go .cta')).toContainText('▶ EP. 1');
	await expect(page.locator('.ch.progress')).toHaveCount(1);
	await page.goto('/?shelf=all');
	await expect(page.locator('.grid .tile', { hasText: 'Yuki no Tabibito' })).toHaveCount(0);
	await page.goto('/history');
	await expect(page.locator('.history')).toContainText('NOT IN LIBRARY');
	await expect(page.locator('.row.record').getByRole('button', { name: '+ ADD' })).toBeVisible();
	// FORGET: the place goes; HISTORY keeps the reading, dimmed, with FIND →.
	await page.goto(preview);
	await record.getByRole('button', { name: 'FORGET' }).click();
	await expect(page.locator('.row.record')).toHaveCount(0);
	await page.goto('/history');
	await expect(page.locator('.row.pruned')).toContainText('NOT KEPT · FORGOTTEN');
	await expect(page.locator('.row.pruned').getByRole('link', { name: 'FIND →' })).toBeVisible();
});

test.describe('the player, tablet landscape (c156)', () => {
	test.use({ viewport: { width: 1280, height: 800 } });

	test('a server that fails is passed over, subtitles, SKIP INTRO, the sheet, the NEXT page', async ({
		page
	}) => {
		test.setTimeout(90_000);
		await page.goto('/');
		await page.getByRole('link', { name: /^ANIME/ }).click();
		await page.locator('.grid .tile', { hasText: 'Tsukiakari no Ryokōsha' }).click();
		await page
			.getByRole('region', { name: 'Episodes' })
			.locator('.entry', { hasText: 'A Letter from Hollin' })
			.locator('.entry-btn')
			.click();
		await expect(page).toHaveURL(/\/read\/\d+/);
		const player = page.locator('.player');
		const shown = async () => {
			// A move, not a jitter: the controls come back after a real one (c217).
			await page.mouse.move(120, 120);
			await page.mouse.move(640, 300 + Math.random() * 10);
		};
		// A browser that won't start a video by itself is started by a tap, as a person would.
		// It may also start by itself between a look at ▶ and the tap (server 2 taking
		// over), and then the bar hides from under the tap, which waited on it until the
		// clip had played through every episode (wave 18, red on its base too): so ▶ is
		// tapped only while the picture is still paused, and again until it plays.
		const pp = player.locator('.cluster .pp');
		await expect(pp).toBeVisible({ timeout: 20_000 });
		const playing = () =>
			page.evaluate(() => {
				const v = document.querySelector('.stage video') as HTMLVideoElement | null;
				return !!v && !v.paused;
			});
		await expect(async () => {
			if (await playing()) return;
			await shown();
			if ((await pp.getAttribute('aria-label')) === 'Play') await pp.click({ timeout: 1000 });
			expect(await playing()).toBe(true);
		}).toPass({ timeout: 20_000 });

		// Server 1 sent nothing: server 2 plays, at the same second, by itself.
		await expect(player.locator('.subs .line')).toHaveText('There is a town past this ridge.', {
			timeout: 20_000
		});
		await expect(player.getByRole('button', { name: 'SKIP INTRO →' })).toBeVisible();
		await shown();
		await expect(player.locator('.top .t')).toContainText(
			'Tsukiakari no Ryokōsha · A Letter from Hollin'
		);
		await expect(player.locator('.cells .grow')).toHaveText('EN SUBS · 360P · 1×');
		// The handoff's frame: a 64px top bar, a 56px scrubber over 64px cells, a 96px cluster.
		await expect(player.locator('.top')).toHaveCSS('height', '64px');
		await expect(player.locator('.scrubrow')).toHaveCSS('height', '56px');
		await expect(player.locator('.cells')).toHaveCSS('height', '64px');
		await expect(player.locator('.cluster button').first()).toHaveCSS('width', '96px');

		// The sheet names the servers, the one that stopped and the one playing.
		await player.locator('.cells .grow').click();
		const sheet = page.getByRole('dialog', { name: 'Playback settings' });
		await expect(sheet).toContainText('PLAYBACK · EP. 9');
		await expect(sheet.locator('.li.on')).toContainText('KWIK');
		await expect(sheet.locator('.li.on')).toContainText('● PLAYING · UP TO 360P');
		await expect(sheet.locator('.li.off')).toContainText('BROKEN');
		await expect(sheet.locator('.li.off')).toContainText('STOPPED');
		await expect(sheet).toHaveCSS('width', '520px');
		await sheet.getByRole('button', { name: 'Close' }).click();

		// The episode ends: the NEXT page counts, and STAY stops it where it is.
		const inter = player.locator('.inter');
		await expect(inter).toContainText('PLAYS IN', { timeout: 20_000 });
		await expect(inter).toContainText('Episode 10');
		const at = page.url();
		await inter.getByRole('button', { name: 'STAY' }).click();
		await page.waitForTimeout(6000);
		expect(page.url()).toBe(at);
		// A link cell keeps its padding as the button cells do (the reset outranked it).
		await expect(inter.getByRole('link', { name: '← SERIES' })).toHaveCSS('padding-right', '24px');

		// Watching is reading: the episode is WATCHED on its series.
		await inter.getByRole('link', { name: '← SERIES' }).click();
		await expect(
			page
				.getByRole('region', { name: 'Episodes' })
				.locator('.entry', { hasText: 'A Letter from Hollin' })
				.locator('.status')
		).toHaveText('WATCHED');
	});

	test('an episode is watched the moment playback reaches its ending’s start (c239)', async ({
		page
	}) => {
		test.setTimeout(90_000);
		await page.goto('/');
		await page.getByRole('link', { name: /^ANIME/ }).click();
		await page.locator('.grid .tile', { hasText: 'Tsukiakari no Ryokōsha' }).click();
		const list = page.getByRole('region', { name: 'Episodes' });
		await list.locator('.entry', { hasText: "The Ferryman's Count" }).locator('.entry-btn').click();
		const player = page.locator('.player');
		const pp = player.locator('.cluster .pp');
		await expect(pp).toBeVisible({ timeout: 20_000 });
		// Server 1's failover notice can hold the middle as the tap lands, and the
		// click then waits out the test (wave 17, 1 run in 4 under load): the
		// player's own key starts it without a tap, as the SKIP ENDING case does.
		if ((await pp.getAttribute('aria-label')) === 'Play') await page.keyboard.press('Space');
		await page.waitForFunction(() => {
			const v = document.querySelector('video');
			return !!v && v.currentTime > 0;
		});
		// The clip's ending starts at 6 s: reaching it is enough, no skip. The
		// player says so to the server, and the series is read once it has: a
		// fixed 1.5 s for that was too short under a loaded suite (c336, c439).
		const finished = page.waitForResponse(
			(r) => r.url().endsWith('/api/reading') && r.request().postDataJSON()?.kind === 'finish'
		);
		await page.evaluate(() => {
			const v = document.querySelector('video');
			if (v) v.currentTime = 6.3;
		});
		await finished;
		const href = await player.getByRole('link', { name: '← SERIES' }).first().getAttribute('href');
		await page.goto(href!);
		await expect(
			list.locator('.entry', { hasText: "The Ferryman's Count" }).locator('.status')
		).toHaveText('WATCHED');
	});

	test('SKIP ENDING marks the episode watched as it is pressed (c239)', async ({ page }) => {
		test.setTimeout(90_000);
		await page.goto('/');
		await page.getByRole('link', { name: /^ANIME/ }).click();
		await page.locator('.grid .tile', { hasText: 'Tsukiakari no Ryokōsha' }).click();
		const list = page.getByRole('region', { name: 'Episodes' });
		// The last episode has no next, which is where SKIP ENDING is offered.
		await list.locator('.entry').last().locator('.entry-btn').click();
		const player = page.locator('.player');
		const pp = player.locator('.cluster .pp');
		await expect(pp).toBeVisible({ timeout: 20_000 });
		// The tap zone can hold the middle before the controls are shown; the
		// player's own key starts it without a tap.
		if ((await pp.getAttribute('aria-label')) === 'Play') await page.keyboard.press('Space');
		await page.waitForFunction(() => {
			const v = document.querySelector('video');
			return !!v && v.currentTime > 0;
		});
		await page.evaluate(() => {
			const v = document.querySelector('video');
			if (v) v.currentTime = 6.2;
		});
		const skip = player.getByRole('button', { name: 'SKIP ENDING →' });
		await expect(skip).toBeVisible({ timeout: 10_000 });
		const finished = page.waitForResponse(
			(r) => r.url().endsWith('/api/reading') && r.request().postDataJSON()?.kind === 'finish'
		);
		await skip.click();
		await finished;
		const href = await player.getByRole('link', { name: '← SERIES' }).first().getAttribute('href');
		await page.goto(href!);
		await expect(list.locator('.entry').last().locator('.status')).toHaveText('WATCHED');
	});

	test('a click plays or pauses, a double-click seeks, and the controls come back on a move (c217, c218)', async ({
		page
	}) => {
		test.setTimeout(90_000);
		await page.goto('/');
		await page.getByRole('link', { name: /^ANIME/ }).click();
		await page.locator('.grid .tile', { hasText: 'Tsukiakari no Ryokōsha' }).click();
		await page
			.getByRole('region', { name: 'Episodes' })
			.locator('.entry', { hasText: 'A Letter from Hollin' })
			.locator('.entry-btn')
			.click();
		await expect(page).toHaveURL(/\/read\/\d+/);
		const player = page.locator('.player');
		const pp = player.locator('.cluster .pp');
		// Server 1 always fails first: its notice holds the middle for 4 s, and a
		// click sent while it lands goes to the notice, after which the controls
		// fade with nothing to bring them back. Wait it out, then move as a person would.
		const notice = player.locator('.panel.servers');
		await expect(notice).toBeVisible({ timeout: 20_000 });
		await expect(notice).toBeHidden({ timeout: 10_000 });
		await page.mouse.move(120, 120);
		await page.mouse.move(640, 300);
		await expect(pp).toBeVisible();
		if ((await pp.getAttribute('aria-label')) === 'Play') await pp.click();
		await expect(pp).toHaveAttribute('aria-label', 'Pause');

		// A quarter of the way down the picture: the middle third across, but clear
		// of the centre cluster and of a server's notice, which sit at 50%.
		const box = (await player.locator('.tapzone').boundingBox())!;
		const mid = { x: box.x + box.width / 2, y: box.y + box.height * 0.25 };

		// The controls go after the mouse stops, and a resting mouse's jitter
		// doesn't bring them back; a move does (c217). First, while the episode
		// still has its eight seconds left.
		await page.mouse.move(mid.x, mid.y);
		await expect(player).toHaveClass(/chrome/);
		await expect(player).not.toHaveClass(/chrome/, { timeout: 6000 });
		await page.mouse.move(mid.x + 2, mid.y + 1);
		await expect(player).not.toHaveClass(/chrome/);
		await page.mouse.move(mid.x + 60, mid.y + 40);
		await expect(player).toHaveClass(/chrome/);

		// The picture is a play/pause button on a desktop: a click in the middle
		// pauses at once (the side thirds wait out the double that seeks).
		await page.mouse.click(mid.x, mid.y);
		await expect(pp).toHaveAttribute('aria-label', 'Play');
		await page.mouse.click(mid.x, mid.y);
		await expect(pp).toHaveAttribute('aria-label', 'Pause');

		// Two clicks on the right third seek 10 s, and don't pause it.
		const right = { x: box.x + box.width * 0.85, y: mid.y };
		await page.mouse.dblclick(right.x, right.y);
		await expect(player.locator('.flash .by')).toHaveText('+10 S');
		await expect(pp).toHaveAttribute('aria-label', 'Pause');

		// The cluster is solid, never drawn half-faded over the picture: the bars
		// fade, it does not.
		await expect(player.locator('.cluster')).toHaveCSS('transition-duration', '0s');
		await expect(player.locator('.top')).not.toHaveCSS('transition-duration', '0s');
	});
});

test('the player in portrait: the picture on top, the controls beneath, what’s next below (c156)', async ({
	page
}) => {
	await page.goto('/');
	await page.getByRole('link', { name: /^ANIME/ }).click();
	await page.locator('.grid .tile', { hasText: 'Tsukiakari no Ryokōsha' }).click();
	await page
		.getByRole('region', { name: 'Episodes' })
		.locator('.entry', { hasText: "The Ferryman's Count" })
		.locator('.entry-btn')
		.click();
	const controls = page.getByRole('region', { name: 'Controls' });
	await expect(controls).toBeVisible({ timeout: 20_000 });
	await expect(controls).toContainText('S2 · EP. 11 OF 12');
	await expect(controls).toContainText('02 — UP NEXT');
	await expect(controls.getByRole('link', { name: /Episode 12/ })).toBeVisible();
	await expect(page.locator('.player .cluster')).toBeHidden();
});

test('episodes download into their folder through the episode lane, and play from the file (c157)', async ({
	page
}) => {
	test.setTimeout(120_000);
	await page.goto('/');
	await page.getByRole('link', { name: /^ANIME/ }).click();
	await page.locator('.grid .tile', { hasText: 'Kōri no Shiro no Majo' }).click();
	await expect(page).toHaveURL(/\/series\/\d+/);
	const seriesUrl = page.url();
	const dl = page.locator('.dl-row');
	await expect(dl).toContainText('4 unwatched episodes not downloaded');
	await dl.locator('.lcs.inline').getByRole('button', { name: 'FIRST 4' }).click();
	const list = page.getByRole('region', { name: 'Episodes' });
	const first = list.locator('.entry', { hasText: 'The First Snow' });
	await expect(first.locator('.status')).toHaveText(/QUEUED|DOWNLOADING|IMPORTING/);

	// The queue screen gives episodes their own lane.
	await page.goto('/downloads');
	await expect(page.locator('body')).toContainText(/EPISODES|NOTHING QUEUED/);

	// ffmpeg muxes each through the episode lane, and each attaches as it's
	// written (c170): no scan is asked for.
	await expect(async () => {
		await page.goto(seriesUrl);
		await expect(first.locator('.status')).toHaveText(/KB|MB/, { timeout: 1000 });
	}).toPass({ timeout: 90_000 });
	await expect(page.locator('.file-meta')).toContainText('DOWNLOADED');

	// A downloaded copy always wins: it plays from the file, subtitles and all.
	await first.locator('.entry-btn').click();
	const player = page.locator('.player');
	await expect(player.locator('.subs .line')).toHaveText('There is a town past this ridge.', {
		timeout: 20_000
	});
	await player.getByRole('button', { name: /EN · / }).click();
	await expect(
		page.getByRole('dialog', { name: 'Playback settings' }).locator('.li.on')
	).toContainText('DOWNLOADED');
});
