import { describe, expect, it } from 'vitest';
import { Asks, entryFor, type AskDeps } from '../src/lib/fetcher/asks.ts';

/** Asks over a fake browser: windows are numbers, the list a plain array. */
function setup(allowed: string[] = []) {
	const opened: string[] = [];
	const focused: number[] = [];
	const closed: number[] = [];
	const list = [...allowed];
	let nextWindow = 10;
	const deps: AskDeps = {
		async open(id) {
			opened.push(id);
			return nextWindow++;
		},
		async focus(w) {
			focused.push(w);
		},
		async close(w) {
			closed.push(w);
		},
		allowed: () => list,
		async allow(entry) {
			list.push(entry);
		},
		seen: (address) => (address === '192.168.1.2' ? { sites: 14, since: 1000 } : undefined)
	};
	return { asks: new Asks(deps), deps, opened, focused, closed, list };
}

const ORIGIN = 'https://tsundoku.lt';
/** Lets the ask open its window before the test answers it. */
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('asking the reader to allow a host', () => {
	it('opens one window, shows only what the fetcher knows, and allows exactly the host and port', async () => {
		const { asks, opened, closed, list } = setup();
		const answer = asks.ask(7, ORIGIN, 'nas.lan', '8080');
		await tick();
		expect(opened).toEqual(['ask-1']);
		expect(asks.details('ask-1')).toEqual({ origin: ORIGIN, host: 'nas.lan', port: '8080' });
		await asks.answer('ask-1', true);
		expect(await answer).toEqual({ allowed: true });
		expect(list).toEqual(['nas.lan:8080']);
		expect(closed).toEqual([10]);
		// The ask is over: its window has nothing more to show.
		expect(asks.details('ask-1')).toBe(null);
	});

	it('takes CANCEL, or the window closing, as no, and asks no more for that host in that tab', async () => {
		const { asks, opened } = setup();
		const first = asks.ask(7, ORIGIN, 'nas.lan', '8080');
		await tick();
		await asks.answer('ask-1', false);
		expect(await first).toEqual({ allowed: false, why: 'cancelled' });
		expect(await asks.ask(7, ORIGIN, 'nas.lan', '8080')).toEqual({
			allowed: false,
			why: 'declined'
		});

		// Closing the window is cancelling.
		const second = asks.ask(7, ORIGIN, 'printer.lan', '631');
		await tick();
		asks.closed(11);
		expect(await second).toEqual({ allowed: false, why: 'cancelled' });

		// Another tab may still ask; the same tab may after it loads a new page.
		const other = asks.ask(8, ORIGIN, 'nas.lan', '8080');
		await tick();
		expect(opened).toEqual(['ask-1', 'ask-2', 'ask-3']);
		await asks.answer('ask-3', false);
		await other;
		asks.reloaded(7);
		const again = asks.ask(7, ORIGIN, 'nas.lan', '8080');
		await tick();
		expect(opened).toHaveLength(4);
		await asks.answer('ask-4', true);
		expect(await again).toEqual({ allowed: true });
	});

	it('asks one thing at a time, bringing the open window forward', async () => {
		const { asks, focused } = setup();
		const first = asks.ask(7, ORIGIN, 'nas.lan', '8080');
		await tick();
		expect(await asks.ask(8, ORIGIN, 'printer.lan', '631')).toEqual({
			allowed: false,
			why: 'busy'
		});
		expect(focused).toEqual([10]);
		await asks.answer('ask-1', true);
		await first;
	});

	it('has nothing to ask about a host on the internet, or one that is not a host', async () => {
		const { asks, opened } = setup();
		for (const [host, port] of [
			['mangadex.org', '443'],
			['1.1.1.1', '80'],
			['nas.lan', '0'],
			['nas.lan', '70000'],
			['nas.lan', 'http'],
			['NAS.lan', '80'],
			['nas lan', '80']
		]) {
			expect(await asks.ask(7, ORIGIN, host, port), `${host}:${port}`).toEqual({
				allowed: false,
				why: 'not-local'
			});
		}
		expect(opened).toEqual([]);
	});

	it('answers yes without a window for a host already allowed', async () => {
		const { asks, opened } = setup(['nas.lan']);
		expect(await asks.ask(7, ORIGIN, 'nas.lan', '8080')).toEqual({ allowed: true });
		const ported = setup(['nas.lan:8080']);
		expect(await ported.asks.ask(7, ORIGIN, 'nas.lan', '8080')).toEqual({ allowed: true });
		expect(opened).toEqual([]);
	});

	it('ignores an answer for an ask that is over, or never was', async () => {
		const { asks, list } = setup();
		await asks.answer('ask-9', true);
		asks.closed(99);
		expect(list).toEqual([]);
	});

	it('says no when the window cannot open, or the allow cannot be stored', async () => {
		const broken = setup();
		broken.deps.open = async () => {
			throw new Error('no windows here');
		};
		expect(await broken.asks.ask(7, ORIGIN, 'nas.lan', '80')).toEqual({
			allowed: false,
			why: 'cancelled'
		});

		const full = setup();
		full.deps.allow = async () => {
			throw new Error('quota');
		};
		const answer = full.asks.ask(7, ORIGIN, 'nas.lan', '80');
		await tick();
		await full.asks.answer('ask-1', true);
		expect(await answer).toEqual({ allowed: false, why: 'cancelled' });
	});

	it('writes an entry as host and port, IPv6 in brackets, or the host alone for every port', () => {
		expect(entryFor('[fd00::1]', '8080')).toBe('[fd00::1]:8080');
		expect(entryFor('192.168.1.2', null)).toBe('192.168.1.2');
	});

	it('asks about a proxy’s address on every port, and shows what the fetcher saw of it', async () => {
		const { asks, list } = setup(['192.168.1.2:3128']);
		const answer = asks.ask(7, ORIGIN, '192.168.1.2', null);
		await tick();
		expect(asks.details('ask-1')).toEqual({
			origin: ORIGIN,
			host: '192.168.1.2',
			port: null,
			seen: { sites: 14, since: 1000 }
		});
		await asks.answer('ask-1', true);
		expect(await answer).toEqual({ allowed: true });
		expect(list).toEqual(['192.168.1.2:3128', '192.168.1.2']);
		// Every port, once allowed, needs no second ask.
		expect(await asks.ask(7, ORIGIN, '192.168.1.2', null)).toEqual({ allowed: true });
	});
});
