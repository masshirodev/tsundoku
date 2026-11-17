import { describe, expect, it } from 'vitest';
import {
	chaptersOf,
	headersOf,
	heightOf,
	LANGS,
	LANG_ROW_MAX,
	langCode,
	langName,
	langRow,
	matchLang,
	onePerLanguage,
	qualitiesLine,
	qualityName,
	playlistSeconds,
	rewritePlaylist,
	serversOf,
	startQuality,
	toVtt,
	trackCodes,
	variantsOf
} from '$lib/library/streams';

// An episode's streams, the pure part (doc/ANIME.md, "Streams").
describe('the engine’s videos', () => {
	const videos = [
		{ quality: 'Kwik - 720p', videoUrl: 'https://k/720.m3u8' },
		{ quality: 'Kwik - 1080p', videoUrl: 'https://k/1080.m3u8' },
		{ quality: 'Vidstream - 1080p · dub', videoUrl: 'https://v/1080.m3u8' },
		{ quality: 'Broken - 360p', videoUrl: null, url: '' }
	];

	it('are servers by hoster, in the source’s order, best quality first; one with no address is none', () => {
		const s = serversOf(videos);
		expect(s.map((x) => [x.n, x.name, x.qualities.map((q) => q.label)])).toEqual([
			[1, 'Kwik', ['1080p', '720p']],
			[2, 'Vidstream', ['1080p · dub']]
		]);
		// A source without hosters is one server.
		expect(
			serversOf([
				{ quality: '1080p', videoUrl: 'x' },
				{ quality: '480p', videoUrl: 'y' }
			])
		).toMatchObject([{ n: 1, name: '', qualities: [{ label: '1080p' }, { label: '480p' }] }]);
	});

	it('start at the best, or 720 on the phone, or the lowest when nothing is that low', () => {
		const [kwik] = serversOf(videos);
		expect(startQuality(kwik, null)?.label).toBe('1080p');
		expect(startQuality(kwik, 720)?.label).toBe('720p');
		expect(startQuality(kwik, 480)?.label).toBe('720p');
		expect(heightOf('1920x1080')).toBe(1080);
		expect(heightOf('Default')).toBeNull();
	});

	it('carry OkHttp’s headers, and the opening and ending only where the source said', () => {
		expect(
			headersOf({ namesAndValues$okhttp: ['Referer', 'https://k/', 'Origin', 'https://k'] })
		).toEqual({
			Referer: 'https://k/',
			Origin: 'https://k'
		});
		expect(headersOf(null)).toEqual({});
		expect(
			chaptersOf({
				timestamps: [
					{ start: 90, end: 180, name: 'Opening', type: 'Opening' },
					{ start: 1300, end: 1390, name: 'ED', type: 'Other' }
				]
			})
		).toEqual({ intro: { start: 90, end: 180 }, ending: { start: 1300, end: 1390 } });
		expect(chaptersOf({ timestamps: [{ start: 5, end: 2, type: 'Opening' }] })).toEqual({
			intro: null,
			ending: null
		});
	});
});

describe('a playlist', () => {
	const master = [
		'#EXTM3U',
		'#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",LANGUAGE="ja",URI="audio/ja.m3u8"',
		'#EXT-X-STREAM-INF:BANDWIDTH=2400000,RESOLUTION=1920x1080,AUDIO="a"',
		'1080/index.m3u8',
		'#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=1280x720',
		'http://10.0.0.5/720.m3u8'
	].join('\n');

	it('has every address replaced by tsundoku’s, relative ones resolved, an unservable one left out', () => {
		const seen: [string, string][] = [];
		const out = rewritePlaylist(master, 'https://cdn.example/show/ep1/master.m3u8', (abs, hint) => {
			seen.push([abs, hint]);
			return abs.includes('10.0.0.5') ? null : `/api/anime/media/${seen.length}`;
		});
		expect(seen).toEqual([
			['https://cdn.example/show/ep1/audio/ja.m3u8', 'playlist'],
			['https://cdn.example/show/ep1/1080/index.m3u8', 'playlist'],
			['http://10.0.0.5/720.m3u8', 'playlist']
		]);
		expect(out).toBe(
			[
				'#EXTM3U',
				'#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",LANGUAGE="ja",URI="/api/anime/media/1"',
				'#EXT-X-STREAM-INF:BANDWIDTH=2400000,RESOLUTION=1920x1080,AUDIO="a"',
				'/api/anime/media/2'
			].join('\n')
		);
		expect(variantsOf(master)).toEqual([
			{ bandwidth: 2400000, height: 1080 },
			{ bandwidth: 1200000, height: 720 }
		]);
		expect(playlistSeconds(master)).toBeNull();
	});

	it('of segments keeps its tags, its key and its length, and drops a segment that can’t be served', () => {
		const media = [
			'#EXTM3U',
			'#EXT-X-TARGETDURATION:10',
			'#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
			'#EXTINF:10.0,',
			'seg0.jpg',
			'#EXTINF:9.5,',
			'http://127.0.0.1:1/seg1.ts',
			'#EXT-X-ENDLIST'
		].join('\n');
		const out = rewritePlaylist(media, 'https://cdn.example/a/', (abs) =>
			abs.startsWith('http://127') ? null : `/t/${abs.split('/').pop()}`
		);
		expect(out).toBe(
			[
				'#EXTM3U',
				'#EXT-X-TARGETDURATION:10',
				'#EXT-X-KEY:METHOD=AES-128,URI="/t/key.bin"',
				'#EXTINF:10.0,',
				'/t/seg0.jpg',
				'#EXT-X-ENDLIST'
			].join('\n')
		);
		expect(playlistSeconds(media)).toBe(19.5);
	});
});

describe('subtitles', () => {
	it('are WebVTT, from SubRip and SubStation too', () => {
		expect(toVtt('WEBVTT\n\n00:00.000 --> 00:01.000\nHi')).toBe(
			'WEBVTT\n\n00:00.000 --> 00:01.000\nHi'
		);
		expect(toVtt('﻿1\r\n00:00:01,500 --> 00:00:03,000\r\nHello\r\n')).toBe(
			'WEBVTT\n\n1\n00:00:01.500 --> 00:00:03.000\nHello\n'
		);
		const ass = [
			'[Script Info]',
			'[Events]',
			'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
			'Dialogue: 0,0:00:02.50,0:00:04.00,Default,,0,0,0,,{\\i1}Wait,{\\i0}\\Nplease'
		].join('\n');
		expect(toVtt(ass)).toBe('WEBVTT\n\n00:00:02.500 --> 00:00:04.000\nWait,\nplease\n');
		// pt-BR is PT-BR; Klingon, a name nobody knows, is cut to a code.
		expect([langCode('English'), langCode('jpn'), langCode('pt-BR'), langCode('Klingon')]).toEqual([
			'EN',
			'JA',
			'PT-BR',
			'KLI'
		]);
		expect([langCode('Hindi'), langCode('Tamil')]).toEqual(['HI', 'TA']);
	});

	it('keep one audio track per language the source names', () => {
		const t = (lang: string, url: string) => ({ lang, url });
		expect(
			onePerLanguage([
				t('Japanese', 'a'),
				t('Japanese', 'b'),
				t('Spanish', 'c'),
				t('Spanish (Latin America)', 'd'),
				t('spanish ', 'e')
			]).map((x) => x.url)
		).toEqual(['a', 'c', 'd']);
	});
});

describe('quality names', () => {
	it('say the height, never a source’s long label, and a server in a few words', () => {
		const long = { label: '2160p (3840x2160) - 7.42 Mbps', height: 2160 };
		expect(qualityName(long)).toBe('2160P');
		expect(qualityName({ label: 'HD - backup', height: null })).toBe('HD');
		expect(qualityName({ label: 'Default', height: null })).toBe('DEFAULT');
		expect(qualitiesLine([long, { label: '720p', height: 720 }])).toBe('UP TO 2160P');
		expect(qualitiesLine([{ label: 'Auto', height: null }])).toBe('AUTO');
		expect(
			qualitiesLine([
				{ label: 'A', height: null },
				{ label: 'B', height: null }
			])
		).toBe('2 QUALITIES');
	});
});

// The sheet's languages (doc/ANIME.md, "The settings sheet").
describe('a track’s language: one short code, the name in full beside it', () => {
	it('names every language of the table by its code, its name and every alias', () => {
		// The whole table, not a sample: an alias that two languages share
		// would make one of them unreachable, and only the exhaustive case sees it.
		const wrong: string[] = [];
		for (const [code, name, ...aliases] of LANGS) {
			for (const a of [code, name, name.toUpperCase(), ...aliases])
				if (langCode(a) !== code.toUpperCase()) wrong.push(`${a} -> ${langCode(a)} (not ${code})`);
			if (langName(code) !== name) wrong.push(`name of ${code}: ${langName(code)}`);
			if (langName(name) !== name) wrong.push(`name of ${name}: ${langName(name)}`);
		}
		expect(wrong).toEqual([]);
		const codes = LANGS.map(([c]) => c);
		expect(new Set(codes).size).toBe(codes.length);
		// No name the table lacks takes a code it has: each of these
		// cuts to another language's ISO 639-2 alias (Chichewa to CHI, which
		// is Chinese's), and took ZH from the Chinese track beside it.
		const known = new Set(codes.map((c) => c.toUpperCase()));
		const unknown = [
			'Greenlandic',
			'Chichewa',
			'Maltese',
			'Malagasy',
			'Montenegrin',
			'Turkmen',
			'Sindhi',
			'Tamazight',
			'Mayan',
			'Buryat'
		];
		expect(unknown.filter((l) => known.has(langCode(l)))).toEqual([]);
		expect(
			trackCodes([
				'Chichewa',
				'Chinese',
				'Sindhi',
				'Sinhala',
				'Tamazight',
				'Tamil',
				'Malagasy',
				'Malayalam'
			])
		).toEqual(['CHC', 'ZH', 'SID', 'SI', 'TAA', 'TA', 'MAA', 'ML']);
	});

	it('gives every label a real server lists a code, never a whole word', () => {
		// VidStreaming (KickAssAnime): the AUDIO row's labels.
		const audio = ['Japanese', 'English', 'German', 'Spanish', 'French', 'Hindi'];
		const long = ['Hungarian', 'Italian', 'Portuguese', 'Thai'];
		expect([...audio, ...long].map(langCode)).toEqual([
			'JA',
			'EN',
			'DE',
			'ES',
			'FR',
			'HI',
			'HU',
			'IT',
			'PT',
			'TH'
		]);
		// And the SUBTITLES row's, the two with a qualifier among them.
		expect(langCode('Chinese (Traditional)')).toBe('ZH-HANT');
		expect(langCode('Norwegian (nob)')).toBe('NB');
		expect(langName('Chinese (Traditional)')).toBe('Chinese (Traditional)');
		expect(langName('Norwegian (nob)')).toBe('Norwegian Bokmål');
	});

	it('tells the variants a sheet offers apart, however the source writes them', () => {
		const cases: [string, string, string][] = [
			['pt-BR', 'PT-BR', 'Portuguese (Brazil)'],
			['Portuguese (Brazil)', 'PT-BR', 'Portuguese (Brazil)'],
			['Brazilian Portuguese', 'PT-BR', 'Portuguese (Brazil)'],
			['Português (Brasil)', 'PT-BR', 'Portuguese (Brazil)'],
			['pt-PT', 'PT', 'Portuguese'],
			['Spanish (Latin America)', 'ES-419', 'Spanish (Latin America)'],
			['Latin American Spanish', 'ES-419', 'Spanish (Latin America)'],
			['es-419', 'ES-419', 'Spanish (Latin America)'],
			['Español (España)', 'ES', 'Spanish'],
			// Crunchyroll's: 'latina' and 'américa' were no ES-419 word,
			// so the pair was ES and ES-2 in the order the source listed them.
			['Español (América Latina)', 'ES-419', 'Spanish (Latin America)'],
			['Spanish (America)', 'ES-419', 'Spanish (Latin America)'],
			['es-ES', 'ES', 'Spanish'],
			['zh-Hant', 'ZH-HANT', 'Chinese (Traditional)'],
			['zh-TW', 'ZH-HANT', 'Chinese (Traditional)'],
			['Traditional Chinese', 'ZH-HANT', 'Chinese (Traditional)'],
			['Chinese (Simplified)', 'ZH-HANS', 'Chinese (Simplified)'],
			['zh-CN', 'ZH-HANS', 'Chinese (Simplified)'],
			['Chinese', 'ZH', 'Chinese'],
			['Chinese (Cantonese)', 'YUE', 'Cantonese'],
			['French (Canada)', 'FR-CA', 'French (Canada)'],
			['fr-CA', 'FR-CA', 'French (Canada)'],
			['Norwegian Bokmål', 'NB', 'Norwegian Bokmål'],
			['Norwegian (Nynorsk)', 'NN', 'Norwegian Nynorsk'],
			['Norwegian', 'NO', 'Norwegian'],
			// A region nobody chooses between is the language itself.
			['en-US', 'EN', 'English'],
			['English (United Kingdom)', 'EN', 'English'],
			['ja-JP', 'JA', 'Japanese'],
			['Bahasa Indonesia', 'ID', 'Indonesian'],
			['Magyar', 'HU', 'Hungarian'],
			['  english  ', 'EN', 'English'],
			['English [CC]', 'EN', 'English']
		];
		expect(cases.map(([l]) => [l, langCode(l), langName(l)])).toEqual(cases);
	});

	it('cuts a name nobody knows to a code, and keeps the name as written', () => {
		expect(langCode('Klingon')).toBe('KLI');
		expect(langName('Klingon')).toBe('Klingon');
		expect(langCode('tlh')).toBe('TLH');
		expect(langCode('Signs & Songs')).toBe('SIG');
		// A cut that is itself an alias is that alias's language, so the code
		// is one langCode gives back unchanged (Indonesia is ID, not IND).
		expect(['Indonesia', 'China', 'Vietnam'].map(langCode)).toEqual(['ID', 'ZH', 'VI']);
		expect(langCode('Ñoño')).toBe('NON');
		// No code the sheet shows is longer than a cell holds.
		const names = LANGS.flatMap(([, name]) => [name, `${name} (Traditional)`, `${name} (Brazil)`]);
		expect(Math.max(...names.map((n) => langCode(n).length))).toBeLessThanOrEqual(7);
	});

	it('gives a blank label, or one with no Latin letters, UND and a name', () => {
		// cleanChoice keeps only capitals A to Z: a blank cell, '-2' or
		// 'ТАГ' could be shown and never remembered.
		expect(trackCodes(['', '', '   '])).toEqual(['UND', 'UND-2', 'UND-3']);
		expect(langName('')).toBe('Unknown');
		expect(langCode('Тагальский')).toBe('UND');
		expect(langName('Тагальский')).toBe('Тагальский');
		expect(langCode('und')).toBe('UND');
		expect(langName('und')).toBe('Unknown');
		expect(trackCodes(['Тагальский', 'Klingon', '', '!!'])).toEqual([
			'UND',
			'KLI',
			'UND-2',
			'UND-3'
		]);
		for (const c of trackCodes(['', 'Тагальский', '日本語字幕なし', 'x', '42']))
			expect(c).toMatch(/^[A-Z]{2,3}(-[A-Z0-9]{1,4}){0,2}$/);
	});

	it('gives every code it makes back as itself, and a choice of it picks that track', () => {
		// matchLang must not read a kept code through langCode first, which would
		// turn ES-2 into ES (the other track) and IND into ID (no track). The whole
		// table, every variant a label carries, and a list with duplicates and
		// unknowns, not a sample.
		const labels = LANGS.flatMap(([code, name, ...aliases]) => [
			code,
			name,
			...aliases,
			`${name} (Brazil)`,
			`${name} (Latin America)`,
			`${name} (Traditional)`,
			`${name} (Simplified)`,
			`${name} (Canada)`
		]);
		const odd = [
			'English',
			'English (Signs & Songs)',
			'Spanish',
			'Español',
			'Klingon',
			'Klingonese',
			'Indonesia',
			'China',
			'Vietnam',
			'Chichewa',
			'Greenlandic',
			'Spanish (Latin America)',
			'es-419',
			'',
			'Тагальский'
		];
		const lists = [trackCodes(labels), trackCodes(odd), trackCodes([...odd, ...odd])];
		const wrong: string[] = [];
		for (const codes of lists) {
			for (const c of codes) {
				if (matchLang(c, codes) !== c) wrong.push(`match ${c} -> ${matchLang(c, codes)}`);
				// A code without trackCodes' numeric suffix reads as itself.
				if (!/-\d{1,2}$/.test(c) && langCode(c) !== c) wrong.push(`code ${c} -> ${langCode(c)}`);
			}
			expect(new Set(codes).size).toBe(codes.length);
		}
		for (const l of [...labels, ...odd])
			if (langCode(langCode(l)) !== langCode(l)) wrong.push(`twice ${l}`);
		expect(wrong).toEqual([]);
		expect(trackCodes(odd).slice(0, 9)).toEqual([
			'EN',
			'EN-2',
			'ES',
			'ES-2',
			'KLI',
			'KLI-2',
			'ID',
			'ZH',
			'VI'
		]);
	});

	it('gives each track of a list its own code', () => {
		expect(
			trackCodes(['Spanish', 'Español', 'Spanish (Latin America)', 'Klingon', 'Klingonese'])
		).toEqual(['ES', 'ES-2', 'ES-419', 'KLI', 'KLI-2']);
	});

	it('reads a choice kept in an older form as the track it meant', () => {
		// Codes a choice could be stored as before: two letters, ISO 639-2's
		// three (a source's "hun", ffprobe's "ita"), and PT for a Brazilian
		// track, which was PT then. A whole word never was: the workstation
		// refused anything but two or three capitals (choices.ts, cleanChoice).
		expect(matchLang('PT', ['JA', 'PT-BR', 'EN'])).toBe('PT-BR');
		expect(matchLang('PT', ['PT', 'PT-BR'])).toBe('PT');
		expect(matchLang('PT-BR', ['PT', 'EN'])).toBe('PT');
		expect(matchLang('HUN', ['JA', 'HU'])).toBe('HU');
		expect(matchLang('ITA', ['JA', 'IT'])).toBe('IT');
		expect(matchLang('ES', ['ES-419', 'ES'])).toBe('ES');
		expect(matchLang('ES-419', ['ES', 'ES-419'])).toBe('ES-419');
		expect(matchLang('pt-BR', ['PT-BR'])).toBe('PT-BR');
		expect(matchLang('FR', ['JA', 'EN'])).toBeUndefined();
		// A choice of IND, kept while Indonesia cut to it, finds the ID track.
		expect(matchLang('IND', ['JA', 'ID'])).toBe('ID');
		// The second of two tracks of one language is that track, and where
		// only one is offered, the language.
		expect(matchLang('EN-2', ['EN', 'EN-2'])).toBe('EN-2');
		expect(matchLang('ES-2', ['ES', 'ES-2', 'ES-419'])).toBe('ES-2');
		expect(matchLang('EN-2', ['JA', 'EN'])).toBe('EN');
	});

	it('shows every language up to LANG_ROW_MAX, and past it what matters with MORE', () => {
		const few = Array.from({ length: LANG_ROW_MAX }, (_, i) => `L${i}`);
		expect(langRow(few, [])).toEqual({ shown: few, more: 0 });
		const many = trackCodes(LANGS.slice(0, 30).map(([, name]) => name));
		expect(many).toHaveLength(30);
		// The current choice, the series' (an old PT for a PT-BR track), the
		// device's language, English; in the source's order, without repeats.
		const row = langRow(many, ['FR', 'PT', 'pt-BR', 'EN', null, undefined, 'XX']);
		expect(row.shown).toEqual(many.filter((c) => ['EN', 'FR'].includes(c)));
		expect(row.more).toBe(30 - row.shown.length);
		const withPt = [...many, 'PT-BR'];
		expect(langRow(withPt, ['PT', 'EN']).shown).toEqual(['EN', 'PT-BR']);
		// The track that is on is a cell, though it is the second of its
		// language or a code its source made up.
		const dup = trackCodes([
			...LANGS.slice(0, 15).map(([, name]) => name),
			'English (Full)',
			'Indonesia'
		]);
		expect(dup).toContain('EN-2');
		expect(langRow(dup, ['EN-2', 'EN']).shown).toEqual(['EN', 'EN-2']);
		const id = langRow(dup, ['ID', 'EN']);
		expect(id.shown).toEqual(['EN', 'ID']);
		expect(id.more).toBe(dup.length - 2);
	});
});
