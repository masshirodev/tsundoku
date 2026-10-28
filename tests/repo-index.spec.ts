import { describe, expect, it } from 'vitest';
import {
	hasUpdate,
	parseIndexLegacy,
	parseIndexV2,
	parseRepoJson,
	repoBase,
	RepoError
} from '$lib/server/engine/repo-index';

// Shaped as Keiyoushi's and Yuzono's were on 2026-10-28 (doc/DOWNLOADER.md).
const FP = '9add655a78e96c4ec7a53ef89dccb557cb5d767489fac5e785d671a5a75d4da2';

describe('a pasted repository address', () => {
	it('names the folder, whichever of its files was pasted', () => {
		const base = 'https://raw.githubusercontent.com/keiyoushi/extensions/repo/';
		for (const f of ['index.min.json', 'index.json', 'repo.json', 'index.pb', ''])
			expect(repoBase(base + f)).toBe(base);
		expect(repoBase(' https://example.org/repo ')).toBe('https://example.org/repo/');
		expect(repoBase('https://example.org/repo/index.min.json?raw=1#x')).toBe(
			'https://example.org/repo/'
		);
	});

	it('refuses what isn’t an https address', () => {
		expect(() => repoBase('keiyoushi')).toThrow(RepoError);
		expect(() => repoBase('http://example.org/repo/index.min.json')).toThrow(/https/);
	});
});

describe('repo.json', () => {
	it('gives the name and the signing key the APKs are checked against', () => {
		expect(
			parseRepoJson({
				index_v2: 'https://github.com/keiyoushi/extensions/raw/repo/index.pb',
				meta: {
					name: 'Keiyoushi',
					website: 'https://keiyoushi.github.io',
					signingKeyFingerprint: FP.toUpperCase()
				}
			})
		).toEqual({ name: 'Keiyoushi', fingerprint: FP, website: 'https://keiyoushi.github.io' });
	});

	// Without a key nothing it lists could be trusted.
	it('refuses a repository without a signing key', () => {
		expect(() => parseRepoJson({ meta: { name: 'X' } })).toThrow(/signing key/);
		expect(() => parseRepoJson({ meta: { name: 'X', signingKeyFingerprint: 'abc' } })).toThrow(
			RepoError
		);
		expect(() => parseRepoJson('<html>')).toThrow(RepoError);
	});
});

describe('index.json (v2)', () => {
	const index = {
		name: 'Keiyoushi',
		signingKey: FP,
		extensionList: {
			extensions: [
				{
					name: 'Asura Scans',
					packageName: 'eu.kanade.tachiyomi.extension.en.asurascans',
					resources: {
						apkUrl:
							'https://github.com/keiyoushi/extensions/releases/download/x/tachiyomi-en.asurascans-v1.6.70.apk',
						iconUrl: 'https://cdn.example/ic.png',
						jarUrl:
							'https://github.com/keiyoushi/extensions/releases/download/x/tachiyomi-en.asurascans-v1.6.70.jar'
					},
					extensionLib: '1.6',
					versionCode: '106070',
					versionName: '1.6.70',
					contentWarning: 'CONTENT_WARNING_SAFE',
					sources: [
						{
							id: '6247824327199706550',
							name: 'Asura Scans',
							language: 'en',
							homeUrl: 'https://asurascans.com'
						}
					]
				},
				{
					name: 'Mixed',
					packageName: 'eu.kanade.tachiyomi.extension.all.mixed',
					resources: { apkUrl: 'https://x/m.apk' },
					contentWarning: 'CONTENT_WARNING_MIXED',
					sources: []
				},
				{
					name: 'An anime one',
					packageName: 'eu.kanade.tachiyomi.animeextension.en.one',
					resources: { apkUrl: 'https://x/a.apk' },
					extensionLib: '16',
					contentWarning: 'CONTENT_WARNING_NSFW',
					sources: []
				},
				{
					name: 'Not an extension',
					packageName: 'eu.kanade.tachiyomi.keiyoushi',
					resources: { apkUrl: 'https://x/k.apk' }
				},
				{ name: 'No APK', packageName: 'eu.kanade.tachiyomi.extension.en.none', resources: {} }
			]
		}
	};

	it('lists each extension, with its kind and whether it’s adult', () => {
		const { fingerprint, listings } = parseIndexV2(index);
		expect(fingerprint).toBe(FP);
		expect(listings.map((l) => [l.pkg.split('.').pop(), l.kind, l.adult])).toEqual([
			['asurascans', 'manga', false],
			['mixed', 'manga', true],
			['one', 'anime', true]
		]);
		expect(listings[0]).toMatchObject({
			versionCode: 106070,
			versionName: '1.6.70',
			lib: '1.6',
			jarUrl: expect.stringMatching(/\.jar$/),
			sources: [{ id: '6247824327199706550', lang: 'en', baseUrl: 'https://asurascans.com' }]
		});
	});

	it('refuses what isn’t an index', () => {
		expect(() => parseIndexV2({ name: 'x' })).toThrow(RepoError);
	});
});

describe('index.min.json (legacy)', () => {
	it('finds the files beside it, and reads its older fields', () => {
		const base = 'https://raw.githubusercontent.com/yuzono/anime-repo/repo/';
		const [l] = parseIndexLegacy(
			[
				{
					name: 'Aniyomi: AnimeOnsen',
					pkg: 'eu.kanade.tachiyomi.animeextension.all.animeonsen',
					apk: 'aniyomi-all.animeonsen-v14.10.apk',
					lang: 'all',
					code: 10,
					version: '14.10',
					nsfw: 0,
					sources: [
						{
							name: 'AnimeOnsen',
							lang: 'all',
							id: '8542735178285060053',
							baseUrl: 'https://www.animeonsen.xyz'
						}
					]
				}
			],
			base
		);
		expect(l).toEqual({
			pkg: 'eu.kanade.tachiyomi.animeextension.all.animeonsen',
			name: 'AnimeOnsen',
			kind: 'anime',
			versionCode: 10,
			versionName: '14.10',
			lib: '14',
			adult: false,
			apkUrl: base + 'apk/aniyomi-all.animeonsen-v14.10.apk',
			jarUrl: null,
			iconUrl: base + 'icon/eu.kanade.tachiyomi.animeextension.all.animeonsen.png',
			sources: [
				{
					id: '8542735178285060053',
					name: 'AnimeOnsen',
					lang: 'all',
					baseUrl: 'https://www.animeonsen.xyz'
				}
			]
		});
	});

	it('offers an update only for a higher version code', () => {
		const l = { versionCode: 106070 } as Parameters<typeof hasUpdate>[0];
		expect(hasUpdate(l, 106069)).toBe(true);
		expect(hasUpdate(l, 106070)).toBe(false);
	});
});
