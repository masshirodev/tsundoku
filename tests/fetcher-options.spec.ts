import { describe, expect, it } from 'vitest';
import {
	ALLOWED_META_KEY,
	checkHandEntry,
	coverage,
	droppedParts,
	readMeta
} from '../src/lib/fetcher/options.ts';

describe('ADD BY HAND', () => {
	it('keeps a host, or a whole address cut down to its host and port', () => {
		expect(checkHandEntry('nas.lan', [])).toEqual({ ok: true, entry: 'nas.lan' });
		expect(checkHandEntry('http://nas.lan:8080/repo/index.min.json', [])).toEqual({
			ok: true,
			entry: 'nas.lan:8080'
		});
		expect(checkHandEntry(' 192.168.1.20:8080 ', [])).toEqual({
			ok: true,
			entry: '192.168.1.20:8080'
		});
		expect(checkHandEntry('[FD12:3456::20]', [])).toEqual({ ok: true, entry: '[fd12:3456::20]' });
	});

	it('refuses what the design’s field board refuses, each for its reason', () => {
		expect(checkHandEntry('nas lan', [])).toEqual({ ok: false, why: 'no-host' });
		expect(checkHandEntry('', [])).toEqual({ ok: false, why: 'no-host' });
		expect(checkHandEntry('ftp://nas.lan/books', [])).toEqual({
			ok: false,
			why: 'scheme',
			scheme: 'ftp',
			host: 'nas.lan'
		});
		expect(checkHandEntry('http://admin:hunter2@192.168.1.1/', [])).toEqual({
			ok: false,
			why: 'password',
			host: '192.168.1.1'
		});
		expect(checkHandEntry('mangadex.org', [])).toEqual({
			ok: false,
			why: 'public',
			host: 'mangadex.org'
		});
		expect(checkHandEntry('192.168.1.20:80800', [])).toEqual({ ok: false, why: 'port' });
		expect(checkHandEntry('192.168.1.20:0', [])).toEqual({ ok: false, why: 'port' });
	});

	it('refuses a duplicate, and an entry an every-port one covers already', () => {
		const list = ['komga.home.arpa', 'nas.lan:8080'];
		expect(checkHandEntry('komga.home.arpa:25600', list)).toEqual({
			ok: false,
			why: 'covered',
			host: 'komga.home.arpa',
			by: 'komga.home.arpa'
		});
		expect(checkHandEntry('nas.lan:8080', list)).toMatchObject({
			ok: false,
			why: 'covered',
			by: 'nas.lan:8080'
		});
		// A port-only entry doesn't cover every port, nor another port.
		expect(checkHandEntry('nas.lan', list)).toEqual({ ok: true, entry: 'nas.lan' });
		expect(checkHandEntry('nas.lan:9000', list)).toEqual({ ok: true, entry: 'nas.lan:9000' });
	});
});

describe('what an entry covers', () => {
	it('names its host and port, and whether it is an address', () => {
		expect(coverage('nas.lan:8080')).toEqual({ host: 'nas.lan', port: '8080', address: false });
		expect(coverage('komga.home.arpa')).toEqual({
			host: 'komga.home.arpa',
			port: null,
			address: false
		});
		expect(coverage('192.168.1.2')).toEqual({ host: '192.168.1.2', port: null, address: true });
		expect(coverage('[fd00::1]:80')).toEqual({ host: '[fd00::1]', port: '80', address: true });
	});

	it('reads where each entry came from, dropping what is not a record', () => {
		expect(
			readMeta({
				[ALLOWED_META_KEY]: {
					'nas.lan:8080': { via: 'asked', at: 5 },
					broken: { via: 'stolen', at: 1 },
					also: 'no'
				}
			})
		).toEqual({ 'nas.lan:8080': { via: 'asked', at: 5 } });
		expect(readMeta({})).toEqual({});
	});
});

describe('what ADD BY HAND drops', () => {
	it('names the scheme and the path it cuts away, and nothing for a host alone', () => {
		expect(droppedParts('http://nas.lan:8080/repo/index.min.json')).toEqual([
			'http://',
			'/repo/index.min.json'
		]);
		expect(droppedParts('HTTPS://nas.lan/')).toEqual(['https://']);
		expect(droppedParts('nas.lan:8080')).toEqual([]);
		expect(droppedParts('nas.lan/x?y')).toEqual(['/x?y']);
	});
});
