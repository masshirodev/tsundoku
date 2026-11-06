import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { getLocale, locales, overwriteGetLocale } from '$lib/paraglide/runtime';
import { m } from '$lib/paraglide/messages';
import {
	chosenLocale,
	ENDONYMS,
	LANG_COOKIE,
	localeFromCookieHeader,
	localeFromLang
} from '$lib/i18n/locale';
import { num, upper } from '$lib/i18n/format';
import { countLine, importDoneLine, startView, trailDone } from '../src/lib/library/start';

/** The languages (doc/I18N.md; card c210): two files that agree, and who decides. */

type Messages = Record<string, unknown>;
const read = (l: string) =>
	JSON.parse(readFileSync(new URL(`../messages/${l}.json`, import.meta.url), 'utf8')) as Messages;
const files = Object.fromEntries(locales.map((l) => [l, read(l)])) as Record<string, Messages>;
const keys = (d: Messages) => Object.keys(d).filter((k) => k !== '$schema');

/** Every {input} a message names, in its text and its variants. */
function inputs(v: unknown): string[] {
	const found = new Set<string>();
	const walk = (x: unknown) => {
		if (typeof x === 'string') for (const [, n] of x.matchAll(/\{(\w+)\}/g)) found.add(n);
		else if (Array.isArray(x)) x.forEach(walk);
		else if (x && typeof x === 'object') {
			const o = x as { declarations?: string[]; match?: Record<string, unknown> };
			for (const d of o.declarations ?? []) {
				const input = /^input (\w+)$/.exec(d);
				if (input) found.add(input[1]);
			}
			if (o.match) Object.values(o.match).forEach(walk);
		}
	};
	walk(v);
	return [...found].sort();
}

function texts(v: unknown): string[] {
	if (typeof v === 'string') return [v];
	if (Array.isArray(v)) return v.flatMap(texts);
	const o = v as { match?: Record<string, unknown> };
	return o?.match ? Object.values(o.match).flatMap(texts) : [];
}

afterEach(() => overwriteGetLocale(() => 'en'));

describe('the two files', () => {
	it('have the same keys', () => {
		expect(keys(files['pt-BR']).sort()).toEqual(keys(files.en).sort());
	});
	it('give every message words in both', () => {
		for (const l of locales)
			for (const k of keys(files[l]))
				for (const t of texts(files[l][k])) expect(t.trim(), `${l} ${k}`).not.toBe('');
	});
	it('name the same inputs in both', () => {
		for (const k of keys(files.en))
			expect(inputs(files['pt-BR'][k]), k).toEqual(inputs(files.en[k]));
	});
	it('keep keys a function can carry, flat snake_case with an area', () => {
		for (const k of keys(files.en)) expect(k).toMatch(/^[a-z]+(_[a-z0-9]+)+$/);
	});
});

describe('who decides the language', () => {
	it('the cookie is ours alone, and only a language we have', () => {
		expect(localeFromCookieHeader(`a=1; ${LANG_COOKIE}=pt-BR; b=2`)).toBe('pt-BR');
		expect(localeFromCookieHeader(`${LANG_COOKIE}=en`)).toBe('en');
		expect(localeFromCookieHeader(`${LANG_COOKIE}=fr`)).toBeUndefined();
		expect(localeFromCookieHeader('PARAGLIDE_LOCALE=pt-BR')).toBeUndefined();
		expect(localeFromCookieHeader(null)).toBeUndefined();
		expect(chosenLocale('auto')).toBeUndefined();
	});
	it('the client reads <html lang>, English when it says nothing we know', () => {
		expect(localeFromLang('pt-BR')).toBe('pt-BR');
		expect(localeFromLang('')).toBe('en');
		expect(localeFromLang(undefined)).toBe('en');
	});
	it('without a request, English: the specs read the base', () => {
		expect(getLocale()).toBe('en');
		expect(m.name_settings()).toBe('SETTINGS');
	});
	it('the picker names each language in itself', () => {
		expect(Object.keys(ENDONYMS).sort()).toEqual([...locales].sort());
		expect(ENDONYMS['pt-BR']).toBe('PORTUGUÊS (BRASIL)');
	});
});

describe('in Portuguese', () => {
	it('numbers and capitals follow the language', () => {
		overwriteGetLocale(() => 'pt-BR');
		expect(num(1234)).toBe('1.234');
		expect(upper('série')).toBe('SÉRIE');
		overwriteGetLocale(() => 'en');
		expect(num(1234)).toBe('1,234');
	});
	it('03 done by an import names it in Portuguese, one series and many (c511)', () => {
		overwriteGetLocale(() => 'pt-BR');
		expect(importDoneLine({ id: 1, app: 'mihon', series: 1 })).toBe(
			'Feito · backup do Mihon · 1 série'
		);
		expect(importDoneLine({ id: 1, app: 'mihon', series: 1234 })).toBe(
			'Feito · backup do Mihon · 1.234 séries'
		);
		expect(m.start_done_link_import()).toBe('REGISTRO DE IMPORTAÇÃO →');
	});
	it('GET STARTED speaks it, plurals and all', () => {
		overwriteGetLocale(() => 'pt-BR');
		const f = {
			repositories: 1,
			installed: 1234,
			series: 2,
			phones: 0,
			records: 1,
			added: 0,
			queued: 0,
			downloaded: 0
		};
		const v = startView(f, ['phone']);
		expect(v.steps.map((s) => s.title)).toEqual([
			'Adicionar um repositório',
			'Instalar uma extensão',
			'Trazer uma biblioteca que você já tem',
			'Ler no celular',
			'Encontrar algo para ler',
			'Adicionar à sua biblioteca',
			'Baixar capítulos'
		]);
		expect(v.steps.map((s) => s.meta)).toEqual([
			'Feito · 1 repositório',
			'Feito · 1.234 instaladas',
			'Feito · 2 séries',
			'Pulado',
			'Feito · 1 série lida online',
			'+ ADICIONAR À BIBLIOTECA guarda · ler online não',
			'A linha DOWNLOAD da série · lê offline'
		]);
		expect(countLine(v)).toBe('4 DE 7 FEITOS · 1 PULADO');
		expect(v.parts.map((p) => p.line)).toEqual(['3 DE 4 FEITOS · 1 PULADO', '1 DE 3 · EM ORDEM']);
		expect(trailDone(v, 'repo')).toEqual({
			a: '✓ 01 FEITO · UM REPOSITÓRIO ADICIONADO',
			b: 'AINDA FALTA · 06 ADICIONAR À SUA BIBLIOTECA'
		});
	});
});
