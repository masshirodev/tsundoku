import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NovelHost, NovelHostError } from '$lib/server/novels/host';

// The LNReader plugin host (doc/NOVELS.md, "The plugin host"; card c147): a
// plugin answers through it, and a plugin that tries to leave its box can't.

let site: Server;
let other: Server;
let port = 0;
let otherPort = 0;
const store = mkdtempSync(join(tmpdir(), 'tsundoku-novel-host-'));
let host: NovelHost;

/** The fixtures, with their site's address written in (the vm context has no env to read). */
function plugin(name: 'good' | 'evil', globals: Record<string, string>, as: string = name): string {
	const src = readFileSync(new URL(`./fixtures/lnreader/${name}.js`, import.meta.url), 'utf8');
	const prelude = Object.entries(globals)
		.map(([k, v]) => `globalThis.${k} = ${JSON.stringify(v)};`)
		.join('\n');
	const file = join(store, `${as}.js`);
	writeFileSync(file, `${prelude}\n${src}`);
	return file;
}

let good = '';
let evil = '';
let shut = '';
let missing = '';

beforeAll(async () => {
	site = createServer((req, res) => {
		const u = new URL(req.url ?? '/', 'http://x');
		if (u.pathname === '/list')
			return res.end(
				`<a class="novel" href="/n/one">One ${u.searchParams.get('sort')} ${u.searchParams.get('latest') ?? ''}</a><a class="novel" href="/n/two">Two</a>`
			);
		if (u.pathname === '/search')
			return res
				.writeHead(200, { 'content-type': 'application/json' })
				.end(JSON.stringify([`${u.searchParams.get('q')}-a`, `${u.searchParams.get('q')}-b`]));
		// A redirect to another loopback port, which the host wasn't opened to.
		if (u.pathname === '/away')
			return res.writeHead(302, { location: `http://127.0.0.1:${otherPort}/` }).end();
		res.writeHead(404).end();
	});
	other = createServer((_, res) => res.end('secret'));
	await new Promise<void>((ok) => site.listen(0, '127.0.0.1', ok));
	await new Promise<void>((ok) => other.listen(0, '127.0.0.1', ok));
	port = (site.address() as AddressInfo).port;
	otherPort = (other.address() as AddressInfo).port;
	good = plugin('good', { SITE: `http://127.0.0.1:${port}/` });
	evil = plugin('evil', {
		LOOPBACK: `http://127.0.0.1:${otherPort}/`,
		REDIRECT: `http://127.0.0.1:${port}/away`
	});
	// The same plugin, its site on a port the host wasn't opened to, and on a path that 404s.
	shut = plugin('good', { SITE: `http://127.0.0.1:${otherPort}/` }, 'shut');
	missing = plugin('good', { SITE: `http://127.0.0.1:${port}/gone/` }, 'missing');
	host = new NovelHost({ store, allow: [`127.0.0.1:${port}`], timeoutMs: 15_000 });
});

afterAll(async () => {
	host.stop();
	site.closeAllConnections();
	other.closeAllConnections();
	await new Promise((ok) => site.close(ok));
	await new Promise((ok) => other.close(ok));
	rmSync(store, { recursive: true, force: true });
});

describe('a plugin, through the host', () => {
	it('says what it is', async () => {
		expect(await host.info(good)).toMatchObject({
			id: 'good',
			name: 'Good Novels',
			version: '1.0.0',
			paged: false,
			filters: { sort: { type: 'Picker', value: 'new' } }
		});
	});

	it('lists, with its filters’ starting values, or the ones it is given', async () => {
		expect(await host.call(good, 'popularNovels', [1, {}])).toEqual([
			{ name: 'One new ', path: '/n/one', cover: '' },
			{ name: 'Two', path: '/n/two', cover: '' }
		]);
		const latest = await host.call<{ name: string }[]>(good, 'popularNovels', [
			2,
			{ showLatestNovels: true, filters: { sort: { type: 'Picker', value: 'top' } } }
		]);
		expect(latest[0].name).toBe('One top 1');
	});

	it('searches, parses a novel, and gives a chapter’s HTML', async () => {
		expect(await host.call(good, 'searchNovels', ['frieren', 1])).toEqual([
			{ name: 'frieren-a', path: '/n/frieren-a' },
			{ name: 'frieren-b', path: '/n/frieren-b' }
		]);
		expect(await host.call(good, 'parseNovel', ['/n/one'])).toMatchObject({
			status: 'Ongoing',
			chapters: [{ name: 'Chapter 1', path: '/n/one/1', releaseTime: '2026-10-28' }]
		});
		expect(await host.call(good, 'parseChapter', ['/n/one/1'])).toBe('<p>/n/one/1</p>');
	});
});

describe('a plugin whose site failed it', () => {
	// fetchText answers '' on failure, as LNReader's does, so the plugin answers
	// nothing: the host says why instead of an empty list.
	it('answers why, not an empty list', async () => {
		await expect(host.call(shut, 'popularNovels', [1, {}])).rejects.toThrow(
			/127\.0\.0\.1 is not on the internet/
		);
		await expect(host.call(missing, 'popularNovels', [1, {}])).rejects.toThrow(
			/127\.0\.0\.1 answered 404/
		);
	});

	it('keeps an answer that has something in it', async () => {
		expect(await host.call(missing, 'parseNovel', ['/n/one'])).toMatchObject({ name: 'A Novel' });
	});
});

describe('a plugin trying to leave its box', () => {
	const refused = (what: string) => host.call(evil, 'parseChapter', [what]);

	it('can’t require what it isn’t given', async () => {
		await expect(refused('require-fs')).rejects.toThrow(/can't require fs/);
	});

	it('finds no environment, even out of the vm context', async () => {
		expect(await refused('env')).toBe('{}');
	});

	it('can’t read a file or start a process, even out of the vm context', async () => {
		await expect(refused('read')).rejects.toThrow(
			/Access to this API has been restricted|ERR_ACCESS_DENIED/
		);
		await expect(refused('spawn')).rejects.toThrow(/restricted|ERR_ACCESS_DENIED/);
	});

	it('can’t fetch a loopback address, directly or by redirect', async () => {
		await expect(refused('loopback')).rejects.toThrow(/not on the internet/);
		await expect(refused('redirect')).rejects.toThrow(/not on the internet/);
	});

	it('is an error the app catches, not a crash', async () => {
		await expect(refused('nonsense')).rejects.toBeInstanceOf(NovelHostError);
		// The host still answers after all of it.
		expect(await host.call(good, 'parseChapter', ['/still'])).toBe('<p>/still</p>');
	});
});
