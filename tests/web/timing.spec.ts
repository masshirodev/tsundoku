import { describe, expect, it } from 'vitest';
import { answerSize, pathOf, siteOf, timingOn, timings } from '../../web/timing.js';

describe('the timing log', () => {
	it('is off unless asked, and never throws on refused storage', () => {
		expect(timingOn()).toBe(false);
		const g = globalThis as { localStorage?: unknown };
		const had = g.localStorage;
		g.localStorage = { getItem: (k: string) => (k === 'tsundoku-timing' ? '1' : null) };
		expect(timingOn()).toBe(true);
		g.localStorage = {
			getItem: () => {
				throw new Error('denied');
			}
		};
		expect(timingOn()).toBe(false);
		g.localStorage = had;
	});

	it('keeps records with their time only when on', () => {
		const on = timings({ on: true, now: () => 12.6 });
		on.record({ kind: 'request', path: '/' });
		expect(on.log).toEqual([{ kind: 'request', path: '/', at: 13 }]);
		const off = timings({ on: false });
		off.record({ kind: 'request', path: '/' });
		expect(off.log).toEqual([]);
	});

	it('drops queries, which can carry a search or a token', () => {
		expect(pathOf('http://localhost/browse/1?q=private')).toBe('/browse/1');
		expect(pathOf('/api/x?y=1')).toBe('/api/x');
		expect(siteOf('GET\nhttps://site.example/a/b?t=1\nAccept: */*')).toEqual({
			host: 'site.example',
			path: '/a/b'
		});
		expect(siteOf('nonsense')).toEqual({ host: '', path: '' });
	});

	it('reads an answer frame’s status and size', () => {
		expect(answerSize('200\ncontent-type: x\n\nAAAA')).toEqual({ status: 200, bytes: 3 });
		expect(answerSize('204\n\n')).toEqual({ status: 204, bytes: 0 });
		expect(answerSize('ERR boom')).toEqual({ status: 0, bytes: 0 });
	});
});
