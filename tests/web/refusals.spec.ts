import { describe, expect, it } from 'vitest';
import {
	forgetRefusals,
	proxySuspect,
	readRefusals,
	recordRefusal,
	REFUSAL_TTL_MS,
	REFUSALS_KEY,
	refusalIn,
	type KeyValue
} from '../../src/lib/web/refusals.ts';

function store(): KeyValue & { map: Map<string, string> } {
	const map = new Map<string, string>();
	return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}
const SENTENCE = (host: string) =>
	`refused: ${host} is on your own network; allow it in the fetcher's options to reach it`;

describe('remembering refusals for the screens', () => {
	it('keeps the newest first, the same sentence once, and forgets them after the TTL', () => {
		const s = store();
		recordRefusal(s, { host: 'nas.lan', port: '8080', asked: true }, SENTENCE('nas.lan'), 1000);
		recordRefusal(
			s,
			{ host: 'printer.lan', port: '631', asked: true },
			SENTENCE('printer.lan'),
			2000
		);
		recordRefusal(s, { host: 'nas.lan', port: '8080', asked: true }, SENTENCE('nas.lan'), 3000);
		expect(readRefusals(s, 3000).map((r) => [r.host, r.at])).toEqual([
			['nas.lan', 3000],
			['printer.lan', 2000]
		]);
		expect(readRefusals(s, 2000 + REFUSAL_TTL_MS).map((r) => r.host)).toEqual(['nas.lan']);
	});

	it('reads nothing from a storage it can’t parse, and drops what isn’t a refusal', () => {
		const s = store();
		s.map.set(REFUSALS_KEY, 'not json');
		expect(readRefusals(s, 0)).toEqual([]);
		s.map.set(
			REFUSALS_KEY,
			JSON.stringify([{ host: 1 }, { host: 'a', port: '1', asked: true, message: 'm', at: 0 }])
		);
		expect(readRefusals(s, 0)).toHaveLength(1);
		s.map.set(REFUSALS_KEY, '{}');
		expect(readRefusals(s, 0)).toEqual([]);
	});

	it('finds the refusal whose sentence an error shows, whatever wraps it or its case', () => {
		const s = store();
		recordRefusal(s, { host: 'nas.lan', port: '8080', asked: true }, SENTENCE('nas.lan'), 1);
		const list = readRefusals(s, 1);
		expect(refusalIn(`java.io.IOException: ${SENTENCE('nas.lan')}`, list)?.host).toBe('nas.lan');
		expect(refusalIn(SENTENCE('nas.lan').toUpperCase(), list)?.port).toBe('8080');
		expect(refusalIn('network error: Failed to fetch', list)).toBe(null);
	});

	it('suspects a proxy only when two or more sites answered from one address', () => {
		const s = store();
		const from = (host: string, at: number) =>
			recordRefusal(
				s,
				{ host, port: '443', asked: true, answeredFrom: '192.168.1.2' },
				`refused: ${host} led to 192.168.1.2, which is on your own network`,
				at
			);
		from('mangadex.org', 1);
		expect(proxySuspect(readRefusals(s, 5))).toBe(null);
		from('weebcentral.com', 2);
		expect(proxySuspect(readRefusals(s, 5))).toEqual({
			address: '192.168.1.2',
			hosts: ['weebcentral.com', 'mangadex.org'],
			since: 1
		});
		// ALLOW for the proxy forgets what it answered.
		forgetRefusals(s, '192.168.1.2', 5);
		expect(readRefusals(s, 5)).toEqual([]);
	});

	it('survives a storage that refuses to be written', () => {
		const full: KeyValue = {
			getItem: () => null,
			setItem: () => {
				throw new Error('quota');
			}
		};
		expect(() =>
			recordRefusal(full, { host: 'a.lan', port: '80', asked: true }, SENTENCE('a.lan'), 0)
		).not.toThrow();
		expect(() => forgetRefusals(full, 'a.lan', 0)).not.toThrow();
	});
});
