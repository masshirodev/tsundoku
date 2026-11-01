import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The tray embeds its icons (ops/release/tray/icon/), so they're committed
 * copies, made by ops/release/installer/icon.sh beside the installer's.
 * Windows' must be the installer's own .ico, or the tray and the Start menu
 * show two different 積s.
 */
const file = (p: string) => readFileSync(new URL(`../ops/release/${p}`, import.meta.url));

describe('the tray’s icons', () => {
	it('on Windows, the installer’s .ico', () => {
		expect(file('tray/icon/tsundoku.ico').equals(file('installer/tsundoku.ico'))).toBe(true);
	});

	it('on Linux, a 64 px PNG', () => {
		const png = file('tray/icon/tsundoku.png');
		expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
		// IHDR's width and height, right after the signature and the chunk's header.
		expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([64, 64]);
	});
});
