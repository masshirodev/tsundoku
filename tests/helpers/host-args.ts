import { readFileSync } from 'node:fs';

/**
 * Chromium flags this machine needs, for every browser the suite launches
 * (playwright.config.ts, and the specs that launch their own).
 *
 * Under WSL 2 each Chromium start probes the GPU WSL passes through
 * (`/dev/dxg`), and the kernel logs `dxgkio_query_adapter_info: Ioctl failed`
 * for every one. On the owner's work box (2026-11-11) bursts of those starts,
 * a long e2e spec re-run by a wave worker, took the whole WSL VM down three
 * times, with no shutdown and no out-of-memory in its journal. The suite
 * renders nothing that needs a GPU, so under WSL Chromium is told not to
 * touch it. Elsewhere nothing changes.
 */
function underWsl(): boolean {
	if (process.env.WSL_DISTRO_NAME) return true;
	try {
		return /microsoft|wsl/i.test(readFileSync('/proc/sys/kernel/osrelease', 'utf8'));
	} catch {
		return false;
	}
}

export const HOST_ARGS: string[] = underWsl() ? ['--disable-gpu'] : [];
