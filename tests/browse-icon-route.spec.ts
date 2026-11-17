import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// An extension's icon (routes/api/browse/icon): its address is the
// repository's to name, so the server fetches it as any address someone else
// named, on the internet only and to a limit (net-guard.ts).

const icons = mkdtempSync(join(tmpdir(), 'tsundoku-icons-'));
let iconUrl = '';

vi.mock('$lib/server/db', () => ({ getDb: () => ({}) }));
vi.mock('$lib/server/prefs', () => ({ isRevealed: () => true }));
vi.mock('$lib/server/engine/browse', () => ({ browseSources: () => [] }));
vi.mock('$lib/server/novels/plugins', () => ({
	findNovelListing: () => null,
	installedPlugins: () => []
}));
vi.mock('$lib/server/engine/extensions', () => ({
	findListing: () => ({ iconUrl }),
	iconsDir: () => icons
}));
vi.mock('node:dns/promises', () => ({
	lookup: async (host: string) => [
		{ address: host === 'inside.example' ? '192.168.1.10' : '93.184.215.14', family: 4 }
	]
}));

const { GET } = await import('../src/routes/api/browse/icon/[pkg]/+server');
const get = (pkg: string) =>
	GET({ params: { pkg }, cookies: {} } as unknown as Parameters<typeof GET>[0]);

afterEach(() => vi.unstubAllGlobals());
afterAll(() => rmSync(icons, { recursive: true, force: true }));

describe('an extension’s icon', () => {
	it('is never fetched from the workstation’s own network', async () => {
		const fetch = vi.fn(async () => new Response('secret'));
		vi.stubGlobal('fetch', fetch);
		for (const [i, at] of [
			'http://127.0.0.1:42143/api/admin',
			'http://[::ffff:127.0.0.1]/x.png',
			'http://inside.example/x.png',
			'http://100.101.102.103/x.png'
		].entries()) {
			iconUrl = at;
			await expect(get(`a.local${i}`), at).rejects.toMatchObject({ status: 404 });
		}
		expect(fetch).not.toHaveBeenCalled();
	});

	it('is not read past its limit', async () => {
		let pulled = 0;
		const body = new ReadableStream<Uint8Array>({
			pull(c) {
				pulled += 1024 * 1024;
				c.enqueue(new Uint8Array(1024 * 1024));
			}
		});
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(body))
		);
		iconUrl = 'https://icons.example/huge.png';
		await expect(get('a.huge')).rejects.toMatchObject({ status: 404 });
		expect(pulled).toBeLessThanOrEqual(6 * 1024 * 1024);
	});
});
