import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readSwitch, writeSwitch } from '$lib/server/engine/webview-switch';

// SETTINGS' WEBVIEW switch as a file the launcher reads (doc/SETTINGS.md, "07 — BROWSE").

const dir = mkdtempSync(join(tmpdir(), 'tsundoku-webview-switch-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('the WebView switch’s file', () => {
	it('is off when there is none: every install starts off', () => {
		expect(readSwitch(join(dir, 'none', 'webview.json'))).toBe(false);
	});

	it('is off when it can’t be read, or says anything but true', () => {
		const f = join(dir, 'junk.json');
		writeFileSync(f, '{"on":');
		expect(readSwitch(f)).toBe(false);
		writeFileSync(f, '{"on":"yes"}');
		expect(readSwitch(f)).toBe(false);
	});

	it('turns on and off, making its folder, and leaves no part file behind', () => {
		const f = join(dir, 'engine', 'webview.json');
		writeSwitch(f, true, 5);
		expect(readSwitch(f)).toBe(true);
		writeSwitch(f, false, 6);
		expect(readSwitch(f)).toBe(false);
		expect(readdirSync(join(dir, 'engine'))).toEqual(['webview.json']);
		expect(existsSync(f)).toBe(true);
	});
});
