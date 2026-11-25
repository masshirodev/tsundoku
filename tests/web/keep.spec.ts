/**
 * Keeping the web edition's library ($lib/web/keep): what SETTINGS says for
 * each answer the browser can give, and the asking itself, with the browser's
 * storage stood in for.
 */
import { describe, expect, it } from 'vitest';
import {
	ASKED_KEY,
	askToKeep,
	browserName,
	keepLines,
	readKeep,
	type KeepEnv
} from '$lib/web/keep';

const UA = {
	firefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:155.0) Gecko/20100101 Firefox/155.0',
	chrome:
		'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
	edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 Edg/153.0.0.0',
	safari:
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
};

describe('the browser’s name', () => {
	it('names each, Edge before the Chrome it also claims to be', () => {
		expect(browserName(UA.firefox)).toBe('FIREFOX');
		expect(browserName(UA.chrome)).toBe('CHROME');
		expect(browserName(UA.edge)).toBe('EDGE');
		expect(browserName(UA.safari)).toBe('SAFARI');
		expect(browserName('curl/8')).toBeNull();
	});
});

describe('what SETTINGS says', () => {
	it('kept: no band, and only clearing the site’s data removes it', () => {
		const l = keepLines({ persisted: true, asked: true, browser: 'FIREFOX' }, 'THIS TABLET');
		expect(l.band).toBeNull();
		expect(l.kept).toEqual({
			name: 'In this browser, on this tablet',
			meta: "KEPT · FIREFOX WON'T CLEAR IT BY ITSELF",
			ask: null
		});
		expect(l.cleared.name).toMatch(/^Only you/);
	});

	it('never asked: no band (asking waits for the first series), and ASK', () => {
		const l = keepLines({ persisted: false, asked: false, browser: 'CHROME' }, 'THIS COMPUTER');
		expect(l.band).toBeNull();
		expect(l.kept.meta).toBe('NOT KEPT FOR SURE · NOT ASKED YET');
		expect(l.kept.ask).toBe('ASK');
		expect(l.cleared.name).toMatch(/when the disk fills/);
	});

	it('asked and refused: the standing band, naming the browser, and ASK AGAIN', () => {
		const l = keepLines({ persisted: false, asked: true, browser: 'FIREFOX' }, 'THIS PHONE');
		expect(l.band?.title).toBe('○ THIS BROWSER CAN CLEAR THE LIBRARY');
		expect(l.band?.detail).toMatch(/^FIREFOX WAS ASKED TO KEEP IT AND SAID NO\./);
		expect(l.band?.detail).toMatch(/THIS BROWSER HOLDS THE ONLY COPY\.$/);
		expect(l.kept).toEqual({
			name: 'In this browser, on this phone',
			meta: 'NOT KEPT FOR SURE · FIREFOX SAID NO',
			ask: 'ASK AGAIN'
		});
	});

	it('an unknown browser is “the browser”, never a blank', () => {
		const l = keepLines({ persisted: false, asked: true, browser: null }, 'THIS TABLET');
		expect(l.band?.detail).toMatch(/^IT WAS ASKED/);
		expect(l.kept.meta).toBe('NOT KEPT FOR SURE · THE BROWSER SAID NO');
	});
});

/** A browser whose storage answers `answer` when asked to persist. */
function env(answer: boolean, opts: { persisted?: boolean; storage?: boolean } = {}) {
	const items = new Map<string, string>();
	let persisted = opts.persisted ?? false;
	const e: KeepEnv = {
		storage:
			opts.storage === false
				? undefined
				: {
						persist: async () => {
							persisted = answer;
							return answer;
						},
						persisted: async () => persisted
					},
		local: {
			getItem: (k) => items.get(k) ?? null,
			setItem: (k, v) => void items.set(k, v)
		},
		userAgent: UA.firefox
	};
	return { e, items };
}

describe('asking', () => {
	it('reads the browser’s answer without asking', async () => {
		const { e } = env(true, { persisted: true });
		expect(await readKeep(e)).toEqual({ persisted: true, asked: false, browser: 'FIREFOX' });
	});

	it('remembers it asked, granted or not', async () => {
		const yes = env(true);
		expect(await askToKeep(yes.e)).toMatchObject({ persisted: true, asked: true });
		expect(yes.items.has(ASKED_KEY)).toBe(true);

		const no = env(false);
		expect(await askToKeep(no.e)).toMatchObject({ persisted: false, asked: true });
		expect(await readKeep(no.e)).toMatchObject({ persisted: false, asked: true });
	});

	it('a browser without the storage manager is simply not kept', async () => {
		const { e } = env(true, { storage: false });
		expect(await readKeep(e)).toMatchObject({ persisted: false });
		expect(await askToKeep(e)).toMatchObject({ persisted: false, asked: true });
	});
});
