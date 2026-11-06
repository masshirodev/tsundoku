import { describe, expect, it } from 'vitest';
import {
	appInstall,
	appLine,
	appModalPhase,
	appView,
	offered,
	parseAppUpdate,
	type AppUpdate
} from '../src/lib/app/update';

const release = { version: '2026.11.06', date: '2026-11-06', notes: 'New.', size: 1000 };
const at = (phase: AppUpdate['phase'], more: Partial<AppUpdate> = {}): AppUpdate => ({
	running: '2026.11.05',
	phase,
	checkedAt: 5,
	...more
});

describe('parseAppUpdate', () => {
	it('reads the bridge, and "" is an app with no updater', () => {
		expect(parseAppUpdate('')).toBeNull();
		expect(parseAppUpdate(JSON.stringify(at('idle')))?.phase).toBe('idle');
	});
	it('refuses what is not the state', () => {
		expect(parseAppUpdate('{')).toBeNull();
		expect(parseAppUpdate('null')).toBeNull();
		expect(parseAppUpdate('{"running":1}')).toBeNull();
	});
});

describe('offered', () => {
	it('offers a release through to its install', () => {
		for (const p of ['available', 'ready', 'downloading', 'permission', 'installing'] as const)
			expect(offered(at(p, release), false)).toBe(true);
	});
	it('offers nothing with no release, or when the app is current', () => {
		expect(offered(null, true)).toBe(false);
		expect(offered(at('available'), false)).toBe(false);
		expect(offered(at('current', release), false)).toBe(false);
	});
	it('a failed check keeps the release it read, and is no failed update', () => {
		expect(offered(at('error', release), false)).toBe(false);
		expect(offered(at('error', release), true)).toBe(true);
	});
});

describe('appInstall and appModalPhase', () => {
	it('counts a download against the signed size', () => {
		expect(appInstall(at('downloading', { ...release, got: 250 }))).toEqual({
			phase: 'downloading',
			bytes: 250,
			total: 1000
		});
		expect(appInstall(at('downloading'))).toEqual({ phase: 'downloading', bytes: 0, total: 0 });
	});
	it('waiting on Android is installing', () => {
		expect(appModalPhase(at('permission'))).toBe('installing');
		expect(appModalPhase(at('installing'))).toBe('installing');
	});
	it('says why it failed', () => {
		expect(appInstall(at('error', { error: 'NO' }))).toEqual({ phase: 'failed', error: 'NO' });
		expect(appInstall(at('error'))).toEqual({ phase: 'failed', error: '' });
		expect(appModalPhase(at('error'))).toBe('failed');
	});
	it('anything else is an offer', () => {
		expect(appInstall(at('available'))).toBeNull();
		expect(appModalPhase(at('ready'))).toBe('offer');
	});
});

describe('appView', () => {
	it('is the modal an install draws', () => {
		const v = appView(at('available', release));
		expect(v.how).toBe('install');
		expect(v.current).toBe('2026.11.05');
		expect(v.available).toEqual(release);
		expect(v.checkedAt).toBe(5);
	});
	it('fills what the state left out', () => {
		const v = appView(at('available', { checkedAt: 0 }));
		expect(v.available).toEqual({ version: '', date: '', notes: '', size: null });
		expect(v.checkedAt).toBeNull();
	});
});

describe('appLine', () => {
	const when = () => 'TODAY';
	it('says each phase', () => {
		expect(appLine(at('checking'), when)).toBe('CHECKING');
		expect(appLine(at('downloading', { ...release, got: 250 }), when)).toBe('DOWNLOADING 25%');
		expect(appLine(at('downloading'), when)).toBe('DOWNLOADING 0%');
		expect(appLine(at('permission'), when)).toContain('ALLOW INSTALLS');
		expect(appLine(at('installing'), when)).toBe('INSTALLING');
		expect(appLine(at('error', { error: 'it stopped' }), when)).toBe('IT STOPPED');
		expect(appLine(at('error'), when)).toBe('');
	});
	it('says a release, on offer or downloaded', () => {
		for (const p of ['available', 'ready'] as const)
			expect(appLine(at(p, release), when)).toBe('2026.11.06 IS OUT · 2026-11-06');
		expect(appLine(at('available'), when)).toBe(' IS OUT · ');
	});
	it('says when it last looked', () => {
		expect(appLine(at('current'), when)).toBe('UP TO DATE · CHECKED TODAY');
		expect(appLine(at('idle', { checkedAt: 0 }), when)).toBe('NOT CHECKED YET');
	});
});
