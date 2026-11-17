import { afterEach, describe, expect, it } from 'vitest';
import { overwriteGetLocale } from '$lib/paraglide/runtime';
import { topics, ask, neighbours, notHere, topicBySlug } from '../src/lib/help/topics';
import { parseSearch } from '../src/lib/library/search';
import { sectionFor } from '../src/lib/settings/catalog';

/** HELP's topics (doc/HELP.md): their shape, where a "?" lands, and /help. */

afterEach(() => overwriteGetLocale(() => 'en'));

/** Words that would point at hidden series or the way to show them, in either language. */
const HIDDEN = /\bhidden\b|\breveal\b|\/reveal|\bhide\b|ocult|escondid|esconder|revel/;

describe('the topics', () => {
	it('seven, numbered in order, each with an In short of three lines at most', () => {
		const TOPICS = topics();
		expect(TOPICS.map((t) => t.n)).toEqual(['01', '02', '03', '04', '05', '06', '07']);
		for (const t of TOPICS) {
			expect(t.short.length).toBeGreaterThan(0);
			expect(t.short.length).toBeLessThanOrEqual(3);
			expect(new Set(t.parts.map((p) => p.id)).size).toBe(t.parts.length);
		}
	});
	it('name no repository, and never hidden series or reveal', () => {
		const all = JSON.stringify(topics()).toLowerCase();
		expect(all).not.toMatch(/https?:\/\//);
		expect(all).not.toMatch(HIDDEN);
	});
	it("03 points at FIRST READ's steps, apart from its In short", () => {
		expect(topicBySlug('downloading')!.pointer).toEqual({
			text: 'GET STARTED walks through it once: steps 05 to 07.',
			label: '05 — 07 →',
			href: '/start#first-read'
		});
		expect(topicBySlug('start')!.short[0]).toMatch(/^Seven steps in two parts/);
	});
	it('04 says a firewall can keep the phone out, on Windows and on Linux', () => {
		const wifi = topicBySlug('phone')!.parts.find((p) => p.id === 'wifi')!;
		const said = wifi.paras!.join(' ');
		expect(said).toMatch(/Windows asks once/);
		expect(said).toMatch(/Linux asks nothing: a firewall there \(ufw, firewalld\)/);
		expect(said).toContain('SETTINGS › 08 — DEVICES › WI-FI names the port');
		overwriteGetLocale(() => 'pt-BR');
		const pt = topicBySlug('phone')!
			.parts.find((p) => p.id === 'wifi')!
			.paras!.join(' ');
		expect(pt).toMatch(/O Linux não pergunta nada/);
	});
	it('03 names both doors to EXTENSIONS: BROWSE, and the row in SETTINGS', () => {
		const part = topicBySlug('downloading')!.parts.find((p) => p.id === 'extensions')!;
		expect(part.paras!.join(' ')).toContain(
			'EXTENSIONS lives in BROWSE, beside the sources it gives. SETTINGS › 07 — BROWSE has a row that opens it too'
		);
	});
	it('link to sections SETTINGS can open by name', () => {
		for (const t of topics())
			for (const p of t.parts) {
				const m = /\/settings\?section=(\w+)/.exec(p.link?.href ?? '');
				if (m) expect(sectionFor(m[1]), m[1]).not.toBeNull();
			}
	});
});

describe('in Portuguese', () => {
	it('the same topics, slugs and anchors, in other words', () => {
		const en = topics();
		overwriteGetLocale(() => 'pt-BR');
		const pt = topics();
		const shape = (ts: typeof en) =>
			ts.map((t) => ({
				slug: t.slug,
				n: t.n,
				short: t.short.length,
				parts: t.parts.map((p) => ({
					id: p.id,
					href: p.link?.href,
					right: !!p.right,
					paras: p.paras?.length,
					table: p.table?.length
				}))
			}));
		expect(shape(pt)).toEqual(shape(en));
		expect(topicBySlug('phone')).toMatchObject({ title: 'Seu celular' });
		expect(ask('phone', 'wifi')).toMatchObject({
			href: '/help/phone#wifi',
			at: 'ABRE EM 01 — WI-FI COM CÓDIGO'
		});
		expect(pt[1].short[0]).not.toBe(en[1].short[0]);
		expect(JSON.stringify(pt)).toContain('CONFIGURAÇÕES › 08 — DISPOSITIVOS');
		expect(notHere('phone', { updater: true, overWifi: true })?.a).toBe('JÁ CONECTADO PELO WI-FI');
	});
	it('never mention hidden series or how to show them either', () => {
		overwriteGetLocale(() => 'pt-BR');
		const all = JSON.stringify(topics()).toLowerCase();
		expect(all).not.toMatch(/https?:\/\//);
		expect(all).not.toMatch(HIDDEN);
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
