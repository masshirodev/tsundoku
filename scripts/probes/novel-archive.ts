/**
 * Which branch of a plugin's chapter archive page mode
 * carries, and whether a POST that needs `X-Requested-With` survives it
 * (doc/NOVELS.md, "A check bound to the browser", "Measured live").
 *
 * NovelFull 2.3.4 asks its archive two ways. With a chapter count on the novel
 * page (`y` truthy) it POSTs a url-encoded form with
 * `X-Requested-With: XMLHttpRequest`; otherwise it GETs the same archive with
 * `?novelId=`. Page mode hands the solver only a method and `postData`, never
 * the plugin's headers, so a POST whose server needs that header is the one
 * shape the app could drop without knowing. This probe walks the first N novels
 * and prints the branch each took, and with a fourth argument also fetches the
 * first chapter of the first C of them, printing, for every page the host asked
 * for, the method, the URL and the body's first characters, and what the call
 * got back.
 *
 * Run it from the repository root, against the DEVELOPMENT solver:
 *
 *   NOVEL_SOLVER_URL=http://127.0.0.1:8193/v1 \
 *     node --experimental-strip-types scripts/probes/novel-archive.ts \
 *       temp/plugins novelfull 12
 *
 * A fourth argument asks for chapters: `… temp/plugins FWN.com 4 3` prints the
 * archive branch of four novels and the first chapter of three.
 *
 * The store is a folder of LNReader plugins, one `.js` per plugin named by its
 * id. Nothing here is imported by the app or the suite.
 */
process.env.DATABASE_PATH ??= ':memory:';
process.env.NOVEL_SOLVER_URL ??= 'http://127.0.0.1:8193/v1';

const { NovelHost } = await import('../../src/lib/server/novels/host.ts');
const { fetchPage, solveChallenge } = await import('../../src/lib/server/novels/solver.ts');

const [storeArg, id, countArg, chapterArg] = process.argv.slice(2);
if (!storeArg || !id) {
	console.error(
		'usage: novel-archive.ts <plugin-store> <plugin-id> [how many novels] [chapters to fetch]'
	);
	process.exit(2);
}
const store = storeArg.endsWith('/') ? storeArg : `${storeArg}/`;
const file = `${store}${id}.js`;
const howMany = Number(countArg ?? 8);
const howManyChapters = Number(chapterArg ?? 0);

const at = (t: number) => `${((Date.now() - t) / 1000).toFixed(1)}s`;
let current = '';
const pages: string[] = [];
const solves: string[] = [];
const host = new NovelHost({
	store,
	solve: async (url) => {
		const t = Date.now();
		const clearance = await solveChallenge(url);
		solves.push(`${url} -> ${clearance ? at(t) : 'null'}`);
		return clearance;
	},
	page: async (req) => {
		const t = Date.now();
		const answer = await fetchPage(req);
		const body = req.postData ? ` body=${JSON.stringify(req.postData.slice(0, 120))}` : '';
		// What page mode handed over, field by field: a PageRequest is
		// `{ url, method?, postData? }`, so there is nowhere for a plugin's
		// header to travel. Printing the keys makes the absence measurable.
		const fields = Object.keys(req).join('+');
		pages.push(
			`${current} | ${req.method ?? 'GET'} ${req.url}${body} (fields=${fields}) -> ${
				'page' in answer
					? `${answer.page.status} ${answer.page.body.length} bytes at ${answer.page.url}`
					: `${answer.fixed ? 'fixed: ' : ''}${answer.unsent ? 'unsent: ' : ''}${answer.error}`
			} in ${at(t)}`
		);
		return answer;
	}
});

const info = await host.info(file);
console.log(`== ${id}: ${info.name} · ${info.site} · v${info.version}`);

let t = Date.now();
current = 'popular';
const popular = await host.call<{ name: string; path: string }[]>(
	file,
	'popularNovels',
	[1, {}],
	120_000
);
console.log(`popular: ${popular?.length ?? 0} in ${at(t)}`);

for (const [i, novel] of (popular ?? []).slice(0, howMany).entries()) {
	current = `#${i + 1} ${novel.name}`;
	const before = pages.length;
	t = Date.now();
	try {
		const got = await host.call<{ chapters: { name: string; path: string }[] }>(
			file,
			'parseNovel',
			[novel.path],
			120_000
		);
		const made = pages.slice(before);
		const methods = [...new Set(made.map((line) => line.split(' | ')[1].split(' ')[0]))];
		console.log(
			`${current} (${novel.path})\n  ${got?.chapters?.length ?? 0} chapters in ${at(t)}, pages: ${methods.join('/') || 'none'}`
		);
		for (const line of made) console.log(`    ${line}`);
		const chapter = got?.chapters?.[0];
		if (i < howManyChapters && chapter) {
			const beforeChapter = pages.length;
			t = Date.now();
			try {
				const gotChapter = await host.chapter(file, chapter.path, 120_000);
				const size = typeof gotChapter?.html === 'string' ? gotChapter.html.length : 0;
				console.log(`  chapter: ${size} bytes at ${gotChapter?.url ?? '(no address)'} in ${at(t)}`);
			} catch (e) {
				console.log(`  chapter ERROR: ${(e as Error).message} in ${at(t)}`);
			}
			for (const line of pages.slice(beforeChapter)) console.log(`    ${line}`);
		}
	} catch (e) {
		console.log(`${current} (${novel.path})\n  ERROR: ${(e as Error).message} in ${at(t)}`);
	}
}

console.log(`\nsolves: ${solves.length ? `\n  ${solves.join('\n  ')}` : 'none'}`);
console.log(`\npages: ${pages.length ? `\n  ${pages.join('\n  ')}` : 'none'}`);
host.stop();
