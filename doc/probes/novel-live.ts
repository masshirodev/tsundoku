/**
 * The live half of c152, reproducible from the commit (doc/NOVELS.md, "Measured
 * live again on 2026-11-02"). It drives the REAL plugin files through the REAL
 * plugin host and the app's REAL solve, and prints the numbers that section
 * quotes: POPULAR, a preview's chapter count, a chapter's size, and every solve
 * the app performed with how long it took.
 *
 * Nothing here is a fixture: the store is the owner's LNReader plugins, one
 * `.js` per plugin named by its id. FlareSolverr 3.4.6 answers on
 * `NOVEL_SOLVER_URL` (the development solver, doc/EXTENSION-ENGINE.md):
 *
 *   NOVEL_SOLVER_URL=http://127.0.0.1:8193/v1 \
 *     node --experimental-strip-types doc/probes/novel-live.ts \
 *       temp/plugins royalroad wuxiaworld novelfull scribblehub novelbin
 *
 * Run it from the repository root. The numbers do drift: a site may change its
 * check, or a plugin may outgrow its site (Novel Bin's API answered the site's
 * SPA shell on 2026-11-02). The measurement wins, and the doc is corrected.
 */
process.env.DATABASE_PATH ??= ':memory:';
process.env.NOVEL_SOLVER_URL ??= 'http://127.0.0.1:8193/v1';

const { NovelHost } = await import('../../src/lib/server/novels/host.ts');
const { solveChallenge } = await import('../../src/lib/server/novels/solver.ts');

const [storeArg, ...plugins] = process.argv.slice(2);
if (!storeArg || !plugins.length) {
	console.error('usage: novel-live.ts <plugin-store> <plugin-id>...');
	process.exit(2);
}
const store = storeArg.endsWith('/') ? storeArg : `${storeArg}/`;

const at = (t: number) => `${((Date.now() - t) / 1000).toFixed(1)}s`;
const solves: string[] = [];
const host = new NovelHost({
	store,
	solve: async (url) => {
		const t = Date.now();
		const clearance = await solveChallenge(url);
		solves.push(`${url} -> ${clearance ? at(t) : 'null'}`);
		return clearance;
	}
});

for (const id of plugins) {
	const file = `${store}${id}.js`;
	const line: string[] = [`\n== ${id}`];
	try {
		const info = await host.info(file);
		line.push(`info: ${info.name} · ${info.site} · v${info.version}`);
		let t = Date.now();
		const popular = await host.call<{ name: string; path: string }[]>(
			file,
			'popularNovels',
			[1, {}],
			120_000
		);
		line.push(`popular: ${popular?.length ?? 0} in ${at(t)}`);
		const first = popular?.[0];
		if (first) {
			line.push(`  first: ${first.name} (${first.path})`);
			t = Date.now();
			const novel = await host.call<{ chapters: { name: string; path: string }[] }>(
				file,
				'parseNovel',
				[first.path],
				120_000
			);
			line.push(`preview: ${novel?.chapters?.length ?? 0} chapters in ${at(t)}`);
			const chapter = novel?.chapters?.[0];
			if (chapter) {
				t = Date.now();
				const html = await host.call<string>(file, 'parseChapter', [chapter.path], 120_000);
				line.push(`chapter: ${(html ?? '').length} bytes in ${at(t)}`);
			}
		}
	} catch (e) {
		line.push(`ERROR: ${(e as Error).message}`);
	}
	console.log(line.join('\n'));
}

console.log(`\nsolves: ${solves.length ? `\n  ${solves.join('\n  ')}` : 'none'}`);
host.stop();
