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

// An episode's streams, the pure part (doc/ANIME.md, "Streams"; card c155).
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
		// pt-BR is PT-BR since c386; Klingon, a name nobody knows, is cut to a code.
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

describe('quality names (2026-10-29)', () => {
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

// The sheet's languages (doc/ANIME.md, "The settings sheet"; card c386).
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
	});

	it('gives every label in the owner’s screenshot a code, never a whole word', () => {
		// VidStreaming (KickAssAnime), 2026-11-03: the AUDIO row's labels.
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
		// And the SUBTITLES row's, the two the owner named among them.
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
		expect(langCode('')).toBe('');
		// No code the sheet shows is longer than a cell holds.
		const names = LANGS.flatMap(([, name]) => [name, `${name} (Traditional)`, `${name} (Brazil)`]);
		expect(Math.max(...names.map((n) => langCode(n).length))).toBeLessThanOrEqual(7);
	});

	it('gives each track of a list its own code', () => {
		expect(
			trackCodes(['Spanish', 'Español', 'Spanish (Latin America)', 'Klingon', 'Klingonese'])
		).toEqual(['ES', 'ES-2', 'ES-419', 'KLI', 'KLI-2']);
	});

	it('reads a choice kept before c386 as the track it meant', () => {
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
	});
});
