import { describe, expect, it } from 'vitest';
import { TOPICS, ask, neighbours, notHere, topicBySlug } from '../src/lib/help/topics';
import { parseSearch } from '../src/lib/library/search';
import { sectionFor } from '../src/lib/settings/catalog';

/** HELP's topics (doc/HELP.md; card c208): their shape, where a "?" lands, and /help. */

describe('the topics', () => {
	it('seven, numbered in order, each with an In short of three lines at most', () => {
		expect(TOPICS.map((t) => t.n)).toEqual(['01', '02', '03', '04', '05', '06', '07']);
		for (const t of TOPICS) {
			expect(t.short.length).toBeGreaterThan(0);
			expect(t.short.length).toBeLessThanOrEqual(3);
			expect(new Set(t.parts.map((p) => p.id)).size).toBe(t.parts.length);
		}
	});
	it('name no repository, and never hidden series or reveal', () => {
		const all = JSON.stringify(TOPICS).toLowerCase();
		expect(all).not.toMatch(/https?:\/\//);
		expect(all).not.toMatch(/\bhidden\b|\breveal\b|\/reveal|\bhide\b/);
	});
	it('link to sections SETTINGS can open by name', () => {
		for (const t of TOPICS)
			for (const p of t.parts) {
				const m = /\/settings\?section=(\w+)/.exec(p.link?.href ?? '');
				if (m) expect(sectionFor(m[1]), m[1]).not.toBeNull();
			}
	});
});

describe('a "?" and its sheet', () => {
	it('opens a topic at a part, and says where', () => {
		expect(ask('phone', 'wifi')).toMatchObject({
			href: '/help/phone#wifi',
			at: 'OPENS AT 01 — WI-FI WITH A CODE'
		});
		expect(ask('downloading', 'download').at).toBe('OPENS AT 03 — ADD, DOWNLOAD, FOLLOW');
		expect(ask('reading').href).toBe('/help/reading');
	});
	it('a topic that cannot apply says so, and still reads', () => {
		expect(notHere('updates', { updater: false, overWifi: false })?.a).toBe(
			'NOT ON THIS INSTALL · IT HAS NO UPDATER'
		);
		expect(notHere('updates', { updater: true, overWifi: false })).toBeNull();
		expect(notHere('phone', { updater: true, overWifi: true })?.a).toBe('ALREADY IN OVER WI-FI');
	});
	it('← and → between topics', () => {
		expect(neighbours('start')).toEqual({ prev: null, next: topicBySlug('reading') });
		expect(neighbours('report').next).toBeNull();
	});
});

describe('/help in search', () => {
	it('opens HELP, or a topic by a word of it', () => {
		expect(parseSearch('/help')).toEqual({ type: 'page', label: 'HELP', href: '/help' });
		expect(parseSearch('/help phone')).toMatchObject({ href: '/help/phone' });
		expect(parseSearch('/HELP download')).toMatchObject({ href: '/help/downloading' });
		expect(parseSearch('/help get')).toMatchObject({ href: '/start' });
		expect(parseSearch('/help zzz')).toMatchObject({ href: '/help' });
		expect(parseSearch('help')).toEqual({ type: 'query', text: 'help' });
	});
});
