import { describe, expect, it } from 'vitest';
import {
	appDevice,
	appVersion,
	deviceKind,
	deviceLabel,
	deviceWord,
	isAppLabel,
	isTsundokuApp,
	isTvApp
} from '../src/lib/settings/catalog.ts';
import { pairedLabel } from '../src/lib/server/pairing.ts';

/**
 * tsundoku's own Android app on a phone or tablet (doc/PHONE-APP.md):
 * its user agent token, and how DEVICES names it. Being the app is a flag
 * beside the kind, never a kind of its own (PhoneApp-Calls.dc.html, DEVICES).
 */
const PHONE =
	'Mozilla/5.0 (Linux; Android 15; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) ' +
	'Version/4.0 Chrome/131.0.6778.135 Mobile Safari/537.36 TsundokuApp/2026.11.05';
const TABLET =
	'Mozilla/5.0 (Linux; Android 14; SM-X710; wv) AppleWebKit/537.36 (KHTML, like Gecko) ' +
	'Version/4.0 Chrome/131.0.6778.135 Safari/537.36 TsundokuApp/2026.11.05';
const TV =
	'Mozilla/5.0 (Linux; Android 9; BRAVIA 4K GB) AppleWebKit/537.36 Chrome/94.0 Safari/537.36 TsundokuTV/2026.11.05';
const CHROME =
	'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36';

describe("the app's user agent", () => {
	it('is the app on a phone, a tablet and a TV, and never in a browser', () => {
		expect(isTsundokuApp(PHONE)).toBe(true);
		expect(isTsundokuApp(TABLET)).toBe(true);
		expect(isTsundokuApp(TV)).toBe(true);
		expect(isTsundokuApp(CHROME)).toBe(false);
	});

	it('makes only the TV a TV: a phone in the app is still a phone', () => {
		expect(isTvApp(PHONE)).toBe(false);
		expect(isTvApp(TV)).toBe(true);
		expect(deviceKind({ width: 390, coarse: true, ua: PHONE })).toBe('phone');
		expect(deviceKind({ width: 1280, coarse: true, ua: TABLET })).toBe('tablet');
		expect(deviceKind({ width: 960, coarse: false, ua: TV })).toBe('tv');
	});

	it("tells the app's own pages a phone from a tablet, and anything else is the TV", () => {
		expect(appDevice(PHONE)).toBe('phone');
		expect(appDevice(TABLET)).toBe('tablet');
		expect(appDevice(TV)).toBe('tv');
		// /pair/tv was only ever the TV's; a browser that opens it gets the TV's page.
		expect(appDevice(CHROME)).toBe('tv');
	});

	it('carries the version, and a browser has none', () => {
		expect(appVersion(PHONE)).toBe('2026.11.05');
		expect(appVersion(TV)).toBe('2026.11.05');
		expect(appVersion(CHROME)).toBe('');
	});
});

describe("the app's row in DEVICES", () => {
	it('says the app and its version where a browser would be', () => {
		expect(deviceLabel(PHONE, 'phone')).toBe('Android phone · app 2026.11.05');
		expect(deviceLabel(TABLET, 'tablet')).toBe('Android tablet · app 2026.11.05');
		expect(deviceLabel(TV, 'tv')).toBe('Android TV · app 2026.11.05');
		expect(deviceLabel(CHROME, 'phone')).toBe('Android phone · Chrome');
	});

	it('pairs as a phone or a tablet from the user agent alone', () => {
		expect(pairedLabel(PHONE)).toBe('Android phone · app 2026.11.05');
		expect(pairedLabel(TABLET)).toBe('Android tablet · app 2026.11.05');
	});

	it("labels the cell with the kind, plus · APP for the app's own", () => {
		expect(deviceWord('phone', deviceLabel(PHONE, 'phone'))).toBe('PHONE · APP');
		expect(deviceWord('tablet', deviceLabel(TABLET, 'tablet'))).toBe('TABLET · APP');
		expect(deviceWord('tv', deviceLabel(TV, 'tv'))).toBe('TV · APP');
		expect(deviceWord('phone', deviceLabel(CHROME, 'phone'))).toBe('PHONE');
	});

	it("reads only what deviceLabel wrote: an older TV row, or a browser's, is no app", () => {
		expect(isAppLabel('Android TV · Chrome')).toBe(false);
		expect(isAppLabel('Android phone · Chrome')).toBe(false);
		expect(isAppLabel('Android phone · app')).toBe(true);
		expect(isAppLabel('Android phone · app 2026.11.05')).toBe(true);
		// A word that only starts with "app" is not the app.
		expect(isAppLabel('Linux desktop · apple')).toBe(false);
	});
});
