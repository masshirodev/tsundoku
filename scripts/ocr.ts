/**
 * The OCR timer's step (doc/JAPANESE.md): read waiting Japanese chapters with
 * mokuro, a batch at a time, until none wait or the time is up.
 *
 *   yarn run ocr                 # what the timer runs
 *   yarn run ocr -- --batch 5    # chapters per mokuro run (default 10)
 *
 * One at a time: a lock in the scratch folder keeps a second run (a slow
 * batch outliving the timer) off the GPU. Nothing it logs is page text.
 */
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

try {
	process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
} catch {
	// No .env: the defaults.
}

const { runOcrBatch, scratchDir } = await import('../src/lib/server/japanese/ocr.ts');

const BUDGET_MS = 50 * 60_000;
const flag = process.argv.indexOf('--batch');
const limit = flag >= 0 ? Number(process.argv[flag + 1]) || 10 : 10;

mkdirSync(scratchDir(), { recursive: true });
const lock = join(scratchDir(), 'ocr.lock');
const alive = (pid: number) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};
try {
	const fd = openSync(lock, 'wx');
	writeSync(fd, String(process.pid));
	closeSync(fd);
} catch {
	const holder = Number(readFileSync(lock, 'utf8'));
	if (alive(holder)) {
		console.log(`ocr: already running (pid ${holder}); next time.`);
		process.exit(0);
	}
	// Left by a run that died.
	rmSync(lock);
	const fd = openSync(lock, 'wx');
	writeSync(fd, String(process.pid));
	closeSync(fd);
}

try {
	const started = Date.now();
	let total = { chapters: 0, blocks: 0, failed: 0 };
	for (;;) {
		const r = await runOcrBatch({ limit, log: (l) => console.log(l) });
		total = {
			chapters: total.chapters + r.chapters,
			blocks: total.blocks + r.blocks,
			failed: total.failed + r.failed
		};
		if (r.chapters + r.failed === 0 || Date.now() - started > BUDGET_MS) break;
	}
	console.log(
		total.chapters + total.failed === 0
			? 'ocr: nothing waiting.'
			: `ocr: ${total.chapters} chapters read, ${total.blocks} blocks, ${total.failed} failed.`
	);
} finally {
	rmSync(lock, { force: true });
}
