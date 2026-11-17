import type { ChildProcess } from 'node:child_process';

/**
 * Starts a preview and waits for it, and only it, to answer on `base`.
 *
 * Both highlights e2e files serve the build on a port the OS gave them, and
 * `vite preview --strictPort` exits when that port is taken after all. A poll
 * that only asks "does something answer on the port?" would then run the
 * file's cases against whichever server holds it, with another file's
 * database (the collision the frame had while it borrowed
 * `PLAYWRIGHT_WORKS_PORT`). So:
 *
 * - before `start` runs, nothing may answer on `base` yet: an answer then is
 *   someone else's server, and the file stops there;
 * - after it, the poll fails the moment its own child has exited, checked
 *   before and after every probe, so a lost port is a clear error.
 *
 * What it cannot see: a server that takes the port in the instant between
 * the OS handing it out and `start`, and answers before our child has had
 * time to exit. Identifying the answering process would close that; the
 * OS's ephemeral port makes the window small enough not to be worth it here.
 */
export async function startPreview(
	start: () => ChildProcess,
	base: string,
	what: string,
	{ tries = 120, waitMs = 500 } = {}
): Promise<ChildProcess> {
	if (await answers(base)) {
		throw new Error(`${what}: something else already answers on ${base}`);
	}
	const child = start();
	const exited = () =>
		child.exitCode !== null || child.signalCode !== null
			? new Error(
					`${what} exited (${child.exitCode ?? child.signalCode}) before it answered on ${base}: its port was taken, or the build is missing`
				)
			: null;
	for (let i = 0; i < tries; i++) {
		const early = exited();
		if (early) throw early;
		const answered = await answers(base);
		// An answer only counts while our own child is still alive.
		const late = exited();
		if (late) throw late;
		if (answered) return child;
		await new Promise((r) => setTimeout(r, waitMs));
	}
	child.kill();
	throw new Error(`${what} never answered on ${base}`);
}

async function answers(base: string): Promise<boolean> {
	try {
		return (await fetch(`${base}/`, { redirect: 'manual' })).status > 0;
	} catch {
		return false;
	}
}
