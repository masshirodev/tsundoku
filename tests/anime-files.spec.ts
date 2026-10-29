import { describe, expect, it } from 'vitest';
import {
	keptTracks,
	episodeNfo,
	episodePath,
	fileSafe,
	iso3,
	muxArgs,
	progressSeconds,
	readEpisodeNfo,
	readTvshowNfo,
	seriesFolderName,
	tvshowNfo
} from '$lib/library/anime-files';

// Anime on disk (doc/ANIME.md, "Downloading"; card c157): Jellyfin's TV layout.
describe('an episode’s place', () => {
	it('is Jellyfin’s: Season NN, the series and SxxEyy in the name', () => {
		expect(seriesFolderName('Tsukiakari no Ryokōsha')).toBe('Tsukiakari no Ryokōsha');
		expect(seriesFolderName('Re:Zero', 2016)).toBe('Re_Zero (2016)');
		expect(
			episodePath({
				series: 'Tsukiakari no Ryokōsha',
				season: 2,
				number: 7,
				title: 'The Lantern Market'
			})
		).toBe('Season 02/Tsukiakari no Ryokōsha S02E07 The Lantern Market.mkv');
		// Absolute numbers stay in season 1; a half keeps its half; no title, no trailing space.
		expect(episodePath({ series: 'One Piece', season: null, number: 1071, title: '' })).toBe(
			'Season 01/One Piece S01E1071.mkv'
		);
		expect(episodePath({ series: 'X', season: 1, number: 7.5, title: 'Special?' })).toBe(
			'Season 01/X S01E07.5 Special_.mkv'
		);
		expect(fileSafe(' ..a/b:c*d.. ')).toBe('a_b_c_d');
		expect(fileSafe('...')).toBe('(untitled)');
	});
});

describe('the NFOs', () => {
	it('carry tsundoku’s keys, and read back as written', () => {
		const show = tvshowNfo({
			key: 'aniyomi:7000:/anime/1',
			title: 'A & B <Show>',
			plot: 'Plot.',
			status: 'ongoing',
			genres: ['Fantasy', 'Slice of Life'],
			source: 'AnimePahe',
			anilist: 171044
		});
		expect(show).toContain(
			'<uniqueid type="tsundoku" default="true">aniyomi:7000:/anime/1</uniqueid>'
		);
		expect(show).toContain('<uniqueid type="anilist">171044</uniqueid>');
		expect(show).toContain('<title>A &amp; B &lt;Show&gt;</title>');
		expect(readTvshowNfo(show)).toEqual({
			key: 'aniyomi:7000:/anime/1',
			title: 'A & B <Show>',
			plot: 'Plot.',
			status: 'ongoing',
			genres: ['Fantasy', 'Slice of Life'],
			source: 'AnimePahe'
		});
		// One tsundoku didn't write is no series of its own.
		expect(readTvshowNfo('<tvshow><title>Mine</title></tvshow>')).toBeNull();

		const ep = episodeNfo({
			sourceUrl: '/e/s2-7?x=1&y=2',
			title: 'The Lantern Market',
			season: 2,
			number: 7,
			position: 19,
			durationS: 1440,
			note: 'recap'
		});
		expect(ep).toContain('<season>2</season>');
		expect(ep).toContain('<episode>7</episode>');
		expect(ep).toContain('<runtime>24</runtime>');
		expect(readEpisodeNfo(ep)).toEqual({
			sourceUrl: '/e/s2-7?x=1&y=2',
			title: 'The Lantern Market',
			season: 2,
			number: 7,
			position: 19,
			durationS: 1440,
			note: 'recap'
		});
		expect(readEpisodeNfo('<episodedetails><episode>3</episode></episodedetails>')).toBeNull();
	});
});

describe('the mux', () => {
	it('copies every stream into one MKV, each track its language, the inputs all tsundoku’s', () => {
		const args = muxArgs({
			video: 'http://127.0.0.1:9/api/anime/media/v',
			audio: [{ url: 'http://127.0.0.1:9/api/anime/media/a', lang: 'JA' }],
			subtitles: [{ url: 'http://127.0.0.1:9/api/anime/subtitle/s', lang: 'EN' }],
			header: 'x-tsundoku: secret',
			out: '/x/ep.mkv.partial',
			title: 'Ep'
		});
		expect(args.filter((a) => a.startsWith('http'))).toEqual([
			'http://127.0.0.1:9/api/anime/media/v',
			'http://127.0.0.1:9/api/anime/media/a',
			'http://127.0.0.1:9/api/anime/subtitle/s'
		]);
		expect(args.join(' ')).toContain('-map 0:v:0 -map 1:a:0 -map 2:s:0 -c copy -c:s srt');
		expect(args.join(' ')).toContain('-metadata:s:a:0 language=jpn -metadata:s:s:0 language=eng');
		expect(args.slice(-3)).toEqual(['-f', 'matroska', '/x/ep.mkv.partial']);
		expect(args.filter((a) => a === '-headers')).toHaveLength(3);
		// The video's own audio when the source gives none apart.
		expect(
			muxArgs({ video: 'v', audio: [], subtitles: [], header: 'h', out: 'o', title: 't' }).join(' ')
		).toContain('-map 0:v:0 -map 0:a? -c copy');
		expect(iso3('ko')).toBe('kor');
		expect([iso3('HI'), iso3('ta')]).toEqual(['hin', 'tam']);
		expect(progressSeconds('frame=1\nout_time_us=12500000\nprogress=continue')).toBe(12.5);
	});
});

describe('what a download keeps (c160)', () => {
	const audio = ['ja', 'en', 'es', 'pt'].map((lang) => ({ lang, src: `/a/${lang}` }));
	const subs = ['en', 'ja', 'fr'].map((lang) => ({ lang, src: `/s/${lang}` }));

	it('keeps every track by default, and the original alone when every language is unticked', () => {
		expect(keptTracks(audio, subs, { kept: null, subs: 'all' })).toEqual({
			audio,
			subtitles: subs
		});
		expect(keptTracks(audio, subs, { kept: [], subs: 'audio' })).toEqual({
			audio: [audio[0]],
			subtitles: [subs[1]]
		});
	});

	it('keeps the original and the chosen, never the original dropped', () => {
		const r = keptTracks(audio, subs, { kept: ['EN'], subs: 'all' });
		expect(r.audio.map((a) => a.lang)).toEqual(['ja', 'en']);
		expect(r.subtitles).toEqual(subs);
		expect(keptTracks(audio, subs, { kept: ['KO'], subs: 'all' }).audio.map((a) => a.lang)).toEqual(
			['ja']
		);
	});

	it('keeps subtitles in the kept audio’s languages, AS AUDIO', () => {
		const r = keptTracks(audio, subs, { kept: ['EN'], subs: 'audio' });
		expect(r.subtitles.map((s) => s.lang)).toEqual(['en', 'ja']);
	});
});
