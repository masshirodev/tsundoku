import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * This device's settings in its browser (settings/local.ts; card c171): each
 * change stamped, the record sent, what's newer taken back, and what the
 * player kept before c171 handed over once.
 */

class Memory {
	m = new Map<string, string>();
	get length() {
		return this.m.size;
	}
	key = (i: number) => [...this.m.keys()][i] ?? null;
	getItem = (k: string) => this.m.get(k) ?? null;
	setItem = (k: string, v: string) => void this.m.set(k, v);
	removeItem = (k: string) => void this.m.delete(k);
}
const storage = new Memory();
vi.stubGlobal('localStorage', storage);
vi.stubGlobal('screen', { width: 800 });
vi.stubGlobal('innerWidth', 800);
vi.stubGlobal('matchMedia', () => ({ matches: true }));

const local = await import('$lib/settings/local');

describe('a device’s own settings', () => {
	beforeEach(() => storage.m.clear());

	it('stamps a change to a device key, and only those', () => {
		local.writeLocal('tsundoku.reader.fit', 'width', 100);
		local.writeLocal('tsundoku.series.sort', 'desc', 100);
		expect(local.localStamped()).toEqual({ 'tsundoku.reader.fit': { v: 'width', at: 100 } });
		expect(local.readLocal('tsundoku.series.sort', null)).toBe('desc');
	});

	it('keeps a reset as a stamped removal, so it reaches the workstation', () => {
		local.writeLocal('tsundoku.reader.crop', true, 100);
		local.writeLocal('tsundoku.reader.crop', undefined, 200);
		expect(storage.getItem('tsundoku.reader.crop')).toBeNull();
		expect(local.localStamped()).toEqual({ 'tsundoku.reader.crop': { v: null, at: 200 } });
	});

	it('sends a value kept before c171 at stamp 0, so anything set elsewhere wins', () => {
		storage.setItem('tsundoku.reader.sides', '20');
		expect(local.localStamped()).toEqual({ 'tsundoku.reader.sides': { v: 20, at: 0 } });
	});

	it('takes what is newer with its stamp, and tells whoever listens', () => {
		const heard: string[] = [];
		const stop = local.onLocalChange((k) => heard.push(k));
		local.applyNewer({
			'tsundoku.reader.fit': { v: 'height', at: 300 },
			'not.a.key': { v: 1, at: 1 }
		});
		stop();
		expect(local.readLocal('tsundoku.reader.fit', null)).toBe('height');
		expect(local.localStamped()['tsundoku.reader.fit']).toEqual({ v: 'height', at: 300 });
		expect(heard).toEqual(['tsundoku.reader.fit']);
	});

	it('checks in, takes back the newer, and hands the player’s old choices over once', async () => {
		storage.setItem('tsundoku:anime:12:audio', '"EN"');
		storage.setItem('tsundoku:anime:dim', '0.2');
		local.writeLocal('tsundoku.reader.fit', 'width', 100);
		const sent: unknown[] = [];
		vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
			sent.push(JSON.parse(String(init.body)));
			return new Response(
				JSON.stringify({ newer: { 'tsundoku.reader.crop': { v: true, at: 500 } } })
			);
		});
		expect(await local.syncDevice()).toBe(true);
		expect(sent[0]).toMatchObject({
			kind: 'tablet',
			settings: { 'tsundoku.reader.fit': { v: 'width', at: 100 } },
			legacy: { 'tsundoku:anime:12:audio': 'EN' }
		});
		expect(local.readLocal('tsundoku.reader.crop', false)).toBe(true);
		expect(storage.getItem('tsundoku:anime:12:audio')).toBeNull();
		// A device setting, not a choice: it stays, and goes as one.
		expect(storage.getItem('tsundoku:anime:dim')).toBe('0.2');
		// The same id every time.
		const id = local.deviceId();
		expect(local.deviceId()).toBe(id);
	});

	it('says so when the workstation doesn’t answer, and keeps everything', async () => {
		storage.setItem('tsundoku:anime:12:audio', '"EN"');
		vi.stubGlobal('fetch', async () => {
			throw new TypeError('offline');
		});
		expect(await local.syncDevice()).toBe(false);
		expect(storage.getItem('tsundoku:anime:12:audio')).toBe('"EN"');
	});
});
