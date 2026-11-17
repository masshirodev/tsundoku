import { describe, expect, it } from 'vitest';
import { scrub } from '../src/lib/server/report-scrub.ts';

const s = {
	secrets: ['tok-AbCdEf123456', 'eng-secret-0001'],
	hidden: ['Secret Series', 'C:/Users/ami/AppData/Local/tsundoku/library/Hidden/Secret Series'],
	paths: [
		['C:/Users/ami/AppData/Local/tsundoku', '<data>'],
		['C:/Users/ami', '<user>']
	] as [string, string][]
};

describe('a report’s scrubbing: hidden means hidden, in a file that leaves the house', () => {
	it('takes out tokens, cookies and pairing links, whatever their values', () => {
		const out = scrub(
			[
				'signed in with tok-AbCdEf123456',
				'cookie: tsundoku_session=abc123def; tsundoku_paired=zzz',
				// Named for its origin since c530 (pairing.ts, pairedCookie).
				'cookie: tsundoku_paired_42143=yyy; tsundoku_paired_s443=xxx',
				'GET /pair/PoJ8cBL1qtir9cPx 303',
				'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9xyz'
			].join('\n'),
			s
		);
		expect(out).not.toMatch(
			/tok-AbCdEf123456|abc123def|zzz|yyy|xxx|PoJ8cBL1qtir9cPx|eyJhbGciOiJIUzI1NiJ9/
		);
		expect(out).toContain('tsundoku_paired_42143=[secret]; tsundoku_paired_s443=[secret]');
		expect(out).toContain('/pair/[code]');
		expect(out).toContain('tsundoku_session=[secret]');
	});

	it('takes out every hidden title and folder, whatever the case or slashes', () => {
		const out = scrub(
			[
				'scanning C:\\Users\\ami\\AppData\\Local\\tsundoku\\library\\Hidden\\Secret Series\\ch1.cbz',
				'imported "secret series" (3 chapters)',
				'imported "Open Series"'
			].join('\n'),
			s
		);
		expect(out.toLowerCase()).not.toContain('secret series');
		expect(out).toContain('Open Series');
	});

	it('shortens the data folder and the user’s home', () => {
		const out = scrub(
			'reading C:/Users/ami/AppData/Local/tsundoku/tsundoku.sqlite and C:\\Users\\ami\\Downloads',
			s
		);
		expect(out).toBe('reading <data>/tsundoku.sqlite and <user>\\Downloads');
	});
});
