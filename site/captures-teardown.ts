import { rmSync } from 'node:fs';

/** The capture run's scratch folder (captures.config.ts) goes with it. */
export default function teardown(): void {
	const dir = process.env.SITE_CAPTURE_SCRATCH;
	if (dir && dir.includes('tsundoku-site-captures-')) rmSync(dir, { recursive: true, force: true });
}
