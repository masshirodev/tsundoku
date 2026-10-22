import { describe, expect, it } from 'vitest';
import { suwayomiAuth } from '$lib/server/suwayomi-auth';

const env = {
	SUWAYOMI_URL: 'http://127.0.0.1:4567',
	SUWAYOMI_USERNAME: 'tsundoku',
	SUWAYOMI_PASSWORD: 'secret'
};

describe("Suwayomi's login", () => {
	it('goes with every request to Suwayomi', () => {
		const want = `Basic ${Buffer.from('tsundoku:secret').toString('base64')}`;
		expect(suwayomiAuth('http://127.0.0.1:4567/api/graphql', env)).toEqual({
			authorization: want
		});
		expect(suwayomiAuth(new URL('http://127.0.0.1:4567/api/v1/backup/x.tachibk'), env)).toEqual({
			authorization: want
		});
	});

	it('never goes to another site, a cover URL included', () => {
		expect(suwayomiAuth('https://example.com/cover.jpg', env)).toEqual({});
		expect(suwayomiAuth('http://127.0.0.1:4568/api/graphql', env)).toEqual({});
		expect(suwayomiAuth('not a url', env)).toEqual({});
	});

	it('is left out until both halves are set', () => {
		expect(suwayomiAuth('http://127.0.0.1:4567/', { ...env, SUWAYOMI_PASSWORD: '' })).toEqual({});
		expect(suwayomiAuth('http://127.0.0.1:4567/', { SUWAYOMI_URL: env.SUWAYOMI_URL })).toEqual({});
	});
});
