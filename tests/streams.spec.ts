import { describe, expect, it } from 'vitest';
import {
	chaptersOf,
	headersOf,
	heightOf,
	langCode,
	playlistSeconds,
	rewritePlaylist,
	serversOf,
	startQuality,
	toVtt,
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
		expect([langCode('English'), langCode('jpn'), langCode('pt-BR'), langCode('Klingon')]).toEqual([
			'EN',
			'JA',
			'PT',
			'KLINGON'
		]);
	});
});
