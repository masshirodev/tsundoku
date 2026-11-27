import { describe, expect, it } from 'vitest';
import { builds, shellName, stale } from '../../src/lib/web/builds';

describe('which build the web edition serves (c1138)', () => {
	it('serves its own build until a leader says otherwise', () => {
		const b = builds('new');
		expect(b.serving()).toBe('new');
		b.leader(null);
		expect(b.serving()).toBe('new');
	});

	it('serves the leader’s older build to every tab, so one build runs at a time', () => {
		const b = builds('new');
		b.leader('old');
		expect(b.serving()).toBe('old');
	});

	it('serves its own build once every tab is moving, whatever an old tab answers meanwhile', () => {
		const b = builds('new');
		b.leader('old');
		b.move();
		expect(b.serving()).toBe('new');
		b.leader('old');
		expect(b.serving()).toBe('new');
		b.leader('new');
		expect(b.serving()).toBe('new');
		// The move is over: a later leader is believed again.
		b.leader('newer');
		expect(b.serving()).toBe('newer');
	});
});

describe('which builds’ files are kept', () => {
	it('keeps its own build and every open tab’s', () => {
		const b = builds('new');
		b.report('a', 'old');
		b.report('b', 'new');
		expect(b.keep(['a', 'b'])).toEqual(new Set(['new', 'old']));
	});

	it('keeps everything while an open tab has not said which build it runs', () => {
		const b = builds('new');
		b.report('a', 'old');
		expect(b.keep(['a', 'b'])).toBeNull();
	});

	it('forgets a closed tab, so its build can go', () => {
		const b = builds('new');
		b.report('a', 'old');
		b.report('b', 'new');
		expect(b.keep(['b'])).toEqual(new Set(['new']));
		// Its word is gone too: it does not come back if its id is seen again unannounced.
		expect(b.keep(['a', 'b'])).toBeNull();
	});

	it('deletes only the shells of builds no longer kept', () => {
		const names = [shellName('old'), shellName('new'), 'tsundoku-entries', 'tsundoku-screens'];
		expect(stale(names, new Set(['new']))).toEqual([shellName('old')]);
		expect(stale(names, new Set(['new', 'old']))).toEqual([]);
	});
});
