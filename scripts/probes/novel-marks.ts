/**
 * The scan behind doc/NOVELS.md's NovelFull note: does any novel page
 * expose a chapter count? NovelFull 2.3.4 POSTs its archive only when `y` is
 * truthy, and `y` is set by `id="indexListPage"`'s `data-total-chapters` or by
 * a `window.chapterPagination` script. This fetches listing pages through the
 * solver, collects their novel links, and prints the marks each novel page
 * carries.
 *
 * Run it from the repository root, against the DEVELOPMENT solver:
 *
 *   NOVEL_SOLVER_URL=http://127.0.0.1:8193/v1 \
 *     node --experimental-strip-types scripts/probes/novel-marks.ts \
 *       'https://novelfull.com/latest-release-novel?page=1' \
 *       'https://novelfull.com/completed-novel?page=1' \
 *       'https://novelfull.com/hot-novel?page=1' \
 *       'https://novelfull.com/most-popular?page=2'
 *
 * `NOVELS=60` is how many collected links it walks (the default). A run over
 * these four listings printed `marks: none` for all sixty. The site prefix is the first listing's origin. Nothing here is
 * imported by the app or the suite.
 */
process.env.DATABASE_PATH ??= ':memory:';
process.env.NOVEL_SOLVER_URL ??= 'http://127.0.0.1:8193/v1';

const { fetchPage } = await import('../../src/lib/server/novels/solver.ts');

const listings = process.argv.slice(2);
if (!listings.length) {
	console.error('usage: novel-marks.ts <listing-url>...');
	process.exit(2);
}
const site = new URL(listings[0]).origin;
const howMany = Number(process.env.NOVELS ?? 60);
const paths = new Set<string>();

for (const url of listings) {
	const a = await fetchPage({ url });
	if (!('page' in a)) {
		console.log(url, '->', a.error);
		continue;
	}
	const body = a.page.body;
	let n = 0;
	for (const m of body.matchAll(/href="([^"]+\.html)"/g)) {
		const path = m[1];
		if (path.includes('chapter') || path.startsWith('http') || path.startsWith('//')) continue;
		paths.add(path.startsWith('/') ? path : `/${path}`);
		n++;
	}
	console.log(url, '->', a.page.status, body.length, 'bytes,', n, 'links');
}

console.log('novels to try:', paths.size);
let i = 0;
for (const path of paths) {
	if (++i > howMany) break;
	const url = `${site}${path}`;
	const a = await fetchPage({ url });
	if (!('page' in a)) {
		console.log(`#${i} ${path} -> ${a.error}`);
		continue;
	}
	const body = a.page.body;
	const marks = [
		'indexListPage',
		'data-total-chapters',
		'chapterPagination',
		'totalChapters'
	].filter((m) => body.includes(m));
	console.log(
		`#${i} ${path} -> ${a.page.status} ${body.length} bytes, marks: ${marks.join(', ') || 'none'}`
	);
	for (const mark of marks) {
		const at = body.indexOf(mark);
		console.log('   ', mark, JSON.stringify(body.slice(Math.max(0, at - 150), at + 300)));
	}
}
process.exit(0);
